import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/sqlite-d1.ts";
import {
  createInvite,
  updateRemaining,
} from "../lib/server/invite-repository.ts";
import { reserveClaim, confirmClaim } from "../lib/server/claim-repository.ts";
import {
  submitReport,
  reviewInvite,
  listReports,
} from "../lib/server/report-repository.ts";
async function setup() {
  const f = fixture();
  const invite = await createInvite(
    f.db,
    { code: "report-code", nickname: "", remaining: 30 },
    "owner",
    f.now(),
  );
  return { ...f, invite };
}
test("single_report_only_pending and repeat_report_no_inflation", async () => {
  const { db, invite, now } = await setup();
  const v = {
    inviteId: invite.id,
    visitorHash: "v",
    reason: "incorrect" as const,
    note: "details",
  };
  const r = await submitReport(db, v, now());
  assert.equal(r.reviewStatus, "pending");
  assert.equal(r.reportCount, 1);
  assert.equal(r.remaining, 30);
  await submitReport(db, v, now());
  const list = await listReports(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].note, "details");
  const claim = await reserveClaim(db, {
    inviteId: invite.id,
    operationId: crypto.randomUUID(),
    visitorHash: "user",
  });
  await confirmClaim(db, claim.operationId, "user");
});
test("owner_cannot_clear_reports and public notes remain private", async () => {
  const { db, invite, now } = await setup();
  await submitReport(
    db,
    {
      inviteId: invite.id,
      visitorHash: "v",
      reason: "expired",
      note: "private phone",
    },
    now(),
  );
  const out = await updateRemaining(db, invite.id, "owner", 5, now());
  assert.equal(out.reviewStatus, "pending");
  assert.ok(!JSON.stringify(out).includes("private phone"));
});
test("restore_preserves_counts and resolves existing reports", async () => {
  const { db, invite, now } = await setup();
  const c = await reserveClaim(db, {
    inviteId: invite.id,
    operationId: crypto.randomUUID(),
    visitorHash: "user",
  });
  await confirmClaim(db, c.operationId, "user");
  await submitReport(
    db,
    { inviteId: invite.id, visitorHash: "v", reason: "expired", note: "" },
    now(),
  );
  const bad = await reviewInvite(db, invite.id, "invalidate", now());
  assert.equal(bad.reviewStatus, "invalid");
  await assert.rejects(
    () =>
      reserveClaim(db, {
        inviteId: invite.id,
        operationId: crypto.randomUUID(),
        visitorHash: "next",
      }),
    /失效/,
  );
  const restored = await reviewInvite(db, invite.id, "restore", now());
  assert.equal(restored.remaining, 29);
  assert.equal(restored.copiedCount, 1);
  assert.equal(restored.createdAt, invite.createdAt);
  assert.equal(restored.reportCount, 0);
  assert.equal(restored.reviewStatus, "normal");
});
test("feedback validates reason and body sizes", async () => {
  const { db, invite, now } = await setup();
  await assert.rejects(
    () =>
      submitReport(
        db,
        {
          inviteId: invite.id,
          visitorHash: "v",
          reason: "made-up",
          note: "",
        } as any,
        now(),
      ),
    /反馈/,
  );
  await assert.rejects(
    () =>
      submitReport(
        db,
        {
          inviteId: invite.id,
          visitorHash: "v",
          reason: "other",
          note: "x".repeat(501),
        },
        now(),
      ),
    /500/,
  );
});
