import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/sqlite-d1.ts";
import { createInvite, getInvite, listInvites } from "../lib/server/invite-repository.ts";
import { reserveClaim, confirmClaim } from "../lib/server/claim-repository.ts";
import { submitUsageFeedback } from "../lib/server/usage-repository.ts";
import { listReports, reviewInvite, submitReport } from "../lib/server/report-repository.ts";

async function setup() {
  const f = fixture();
  const invite = await createInvite(
    f.db,
    { code: "usage-feedback", nickname: "", remaining: 30 },
    "owner",
    f.now(),
  );
  return { ...f, invite };
}

async function confirmed(f: Awaited<ReturnType<typeof setup>>, visitor = "visitor") {
  const operationId = crypto.randomUUID();
  await reserveClaim(f.db, { inviteId: f.invite.id, operationId, visitorHash: visitor });
  await confirmClaim(f.db, operationId, visitor);
  return operationId;
}

test("copying does not imply a successful redemption", async () => {
  const f = await setup();
  await confirmed(f);
  for (const invite of [await getInvite(f.db, f.invite.id), ...(await listInvites(f.db))]) {
    assert.equal(invite.lastVerifiedAt, null);
    assert.equal(invite.successCount, 0);
    assert.equal(invite.failureCount, 0);
    assert.equal(invite.remaining, 29);
    assert.equal(invite.copiedCount, 1);
  }
});

test("successful redemption uses database time without consuming another slot", async () => {
  const f = await setup();
  const id = await confirmed(f);
  f.advance(17);
  const result = await submitUsageFeedback(f.db, id, "visitor", { outcome: "success" });
  assert.deepEqual(result.feedback, { outcome: "success", recordedAt: "2027-01-15T08:00:17.000Z" });
  assert.equal(result.invite.lastVerifiedAt, "2027-01-15T08:00:17.000Z");
  assert.equal(result.invite.successCount, 1);
  assert.equal(result.invite.failureCount, 0);
  assert.equal(result.invite.remaining, 29);
  assert.equal(result.invite.copiedCount, 1);
  assert.deepEqual(Object.keys(result.feedback).sort(), ["outcome", "recordedAt"]);
});

test("concurrent same-outcome retries record a single immutable timestamp", async () => {
  const f = await setup();
  const id = await confirmed(f);
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    submitUsageFeedback(f.db, id, "visitor", { outcome: "success" })));
  assert.equal(new Set(results.map((r) => r.feedback.recordedAt)).size, 1);
  assert.equal((await getInvite(f.db, f.invite.id)).successCount, 1);
  f.advance(200);
  const again = await submitUsageFeedback(f.db, id, "visitor", { outcome: "success" });
  assert.equal(again.feedback.recordedAt, "2027-01-15T08:00:00.000Z");
  await assert.rejects(() => submitUsageFeedback(f.db, id, "visitor", { outcome: "failure" }), { status: 409, code: "outcome_conflict" });
});

test("concurrent conflicting outcomes have one winner and matching report side effects", async () => {
  const f = await setup();
  const id = await confirmed(f);
  const results = await Promise.allSettled([
    submitUsageFeedback(f.db, id, "visitor", { outcome: "failure", reason: "expired", note: "private details" }),
    submitUsageFeedback(f.db, id, "visitor", { outcome: "success" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find((r) => r.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.equal(rejected.reason.code, "outcome_conflict");
  const invite = await getInvite(f.db, f.invite.id);
  assert.equal(invite.successCount + invite.failureCount, 1);
  const reports = await listReports(f.db);
  assert.equal(reports.length, invite.failureCount);
  assert.equal(invite.reviewStatus, invite.failureCount ? "pending" : "normal");
  assert.equal(invite.remaining, 29);
});

test("foreign visitors and unconfirmed claims cannot submit usage results", async () => {
  const f = await setup();
  const id = crypto.randomUUID();
  await reserveClaim(f.db, { inviteId: f.invite.id, operationId: id, visitorHash: "visitor" });
  await assert.rejects(() => submitUsageFeedback(f.db, id, "visitor", { outcome: "success" }), { status: 409, code: "feedback_unavailable" });
  await confirmClaim(f.db, id, "visitor");
  await assert.rejects(() => submitUsageFeedback(f.db, id, "other", { outcome: "failure" }), { status: 403, code: "wrong_visitor" });
  await assert.rejects(() => submitUsageFeedback(f.db, crypto.randomUUID(), "visitor", { outcome: "success" }), { status: 404, code: "not_found" });
  const invite = await getInvite(f.db, f.invite.id);
  assert.equal(invite.successCount + invite.failureCount, 0);
  assert.equal(invite.reportCount, 0);
});

test("usage feedback expires after seven days including idempotent retries", async () => {
  const f = await setup();
  const id = await confirmed(f);
  f.advance(604800);
  const allowed = await submitUsageFeedback(f.db, id, "visitor", { outcome: "success" });
  assert.equal(allowed.invite.successCount, 1);
  f.advance(1);
  await assert.rejects(() => submitUsageFeedback(f.db, id, "visitor", { outcome: "success" }), { status: 409, code: "feedback_unavailable" });
  assert.equal((await getInvite(f.db, f.invite.id)).lastVerifiedAt, allowed.feedback.recordedAt);
});

test("invalidation clears public verification aggregates and rejects prior claims after restore", async () => {
  const f = await setup();
  const id = await confirmed(f);
  await submitUsageFeedback(f.db, id, "visitor", { outcome: "success" });
  const invalid = await reviewInvite(f.db, f.invite.id, "invalidate", f.now());
  assert.equal(invalid.lastVerifiedAt, null);
  assert.equal(invalid.successCount, 0);
  assert.equal(invalid.failureCount, 0);
  await reviewInvite(f.db, f.invite.id, "restore", f.now());
  await assert.rejects(() => submitUsageFeedback(f.db, id, "visitor", { outcome: "success" }), { status: 409, code: "feedback_unavailable" });
  assert.equal((await getInvite(f.db, f.invite.id)).lastVerifiedAt, null);
});

test("failure defaults to other and privately queues one report while retaining quota", async () => {
  const f = await setup();
  const id = await confirmed(f);
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    submitUsageFeedback(f.db, id, "visitor", { outcome: "failure", note: " private phone " })));
  const result = results[0];
  assert.equal(result.invite.reviewStatus, "pending");
  assert.equal(result.invite.failureCount, 1);
  assert.equal(result.invite.successCount, 0);
  assert.equal(result.invite.lastVerifiedAt, null);
  assert.equal(result.invite.reportCount, 1);
  assert.deepEqual(result.invite.reportReasons, ["other"]);
  assert.equal(result.invite.remaining, 29);
  assert.ok(!JSON.stringify(result).includes("private phone"));
  assert.ok(!JSON.stringify(result).includes("visitor"));
  const reports = await listReports(f.db);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].note, "private phone");
  assert.equal(reports[0].reason, "other");
});

test("retrying a recorded failure cannot reopen a report resolved by moderation", async () => {
  const f = await setup();
  const id = await confirmed(f);
  const original = await submitUsageFeedback(f.db, id, "visitor", { outcome: "failure", reason: "incorrect", note: "original" });
  await reviewInvite(f.db, f.invite.id, "restore", f.now());
  f.advance(11);
  const retry = await submitUsageFeedback(f.db, id, "visitor", { outcome: "failure", reason: "expired", note: "replacement" });
  assert.deepEqual(retry.feedback, original.feedback);
  assert.equal(retry.invite.reviewStatus, "normal");
  assert.equal(retry.invite.reportCount, 0);
  assert.equal(retry.invite.failureCount, 1);
  assert.equal((await listReports(f.db)).length, 0);
});

test("success keeps pending reports and lastVerifiedAt tracks the latest successful result", async () => {
  const f = await setup();
  const a = await confirmed(f, "a");
  const b = await confirmed(f, "b");
  const c = await confirmed(f, "c");
  await submitReport(f.db, { inviteId: f.invite.id, visitorHash: "reporter", reason: "incorrect", note: "private" }, f.now());
  await submitUsageFeedback(f.db, a, "a", { outcome: "success" });
  f.advance(30);
  const latest = await submitUsageFeedback(f.db, b, "b", { outcome: "success" });
  f.advance(30);
  const failure = await submitUsageFeedback(f.db, c, "c", { outcome: "failure" });
  assert.equal(latest.invite.reviewStatus, "pending");
  assert.equal(latest.invite.reportCount, 1);
  assert.equal(failure.invite.lastVerifiedAt, "2027-01-15T08:00:30.000Z");
  assert.equal(failure.invite.successCount, 2);
  assert.equal(failure.invite.failureCount, 1);
});

test("feedback validates outcome reason and note before any write", async () => {
  const f = await setup();
  const id = await confirmed(f);
  for (const payload of [null, [], {}, { outcome: "maybe" }, { outcome: "failure", reason: "unknown" }, { outcome: "failure", note: 123 }, { outcome: "failure", note: "x".repeat(501) }]) {
    await assert.rejects(() => submitUsageFeedback(f.db, id, "visitor", payload), { status: 400 });
  }
  const invite = await getInvite(f.db, f.invite.id);
  assert.equal(invite.failureCount + invite.successCount, 0);
  assert.equal(invite.reportCount, 0);
});

test("report write failure rolls back the associated usage result", async () => {
  const f = await setup();
  const id = await confirmed(f);
  f.sqlite.exec("CREATE TRIGGER reject_report BEFORE INSERT ON reports BEGIN SELECT RAISE(ABORT,'report unavailable'); END");
  await assert.rejects(() => submitUsageFeedback(f.db, id, "visitor", { outcome: "failure" }), /report unavailable/);
  const invite = await getInvite(f.db, f.invite.id);
  assert.equal(invite.failureCount, 0);
  assert.equal(invite.reviewStatus, "normal");
  f.sqlite.exec("DROP TRIGGER reject_report");
  assert.equal((await submitUsageFeedback(f.db, id, "visitor", { outcome: "failure" })).invite.failureCount, 1);
});

test("invalidation between eligibility read and write cannot create feedback or reports", async () => {
  const f = await setup();
  const id = await confirmed(f);
  const racedDb = {
    prepare: f.db.prepare.bind(f.db),
    batch: async (statements: D1PreparedStatement[]) => {
      f.sqlite.prepare("UPDATE invites SET copy_revision=copy_revision+1,review_status='invalid' WHERE id=?").run(f.invite.id);
      return f.db.batch(statements);
    },
  } as D1Database;
  await assert.rejects(() => submitUsageFeedback(racedDb, id, "visitor", { outcome: "failure" }), { status: 409, code: "feedback_unavailable" });
  const invite = await getInvite(f.db, f.invite.id);
  assert.equal(invite.failureCount, 0);
  assert.equal(invite.reportCount, 0);
  assert.equal(Number(f.sqlite.prepare("SELECT count(*) n FROM usage_feedback").get()?.n), 0);
});
