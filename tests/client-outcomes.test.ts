import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/sqlite-d1.ts";
import { createInvite, getInvite } from "../lib/server/invite-repository.ts";
import { reserveClaim, confirmClaim, cancelClaim } from "../lib/server/claim-repository.ts";
import { copyInvite, retryPending } from "../lib/client/copy-invite.ts";
import * as stored from "../lib/client/storage.ts";

test("confirmed clipboard copies retain the server operation identity for later usage feedback", async () => {
  const f = fixture();
  const invite = await createInvite(f.db, { code: "outcome-copy", nickname: "", remaining: 2 }, "owner", f.now());
  const operationId = "11111111-1111-4111-8111-111111111111";
  const api = {
    reserve: (inviteId: string, id: string) => reserveClaim(f.db, { inviteId, operationId: id, visitorHash: "feedback-visitor" }),
    confirm: (id: string) => confirmClaim(f.db, id, "feedback-visitor"),
    cancel: (id: string) => cancelClaim(f.db, id, "feedback-visitor"),
  };
  const reservation = await api.reserve(invite.id, operationId);
  const result = await copyInvite({
    inviteId: invite.id, api, reservation,
    clipboard: { writeText: async () => {} },
    storage: { setItem: () => {}, removeItem: () => {} },
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.operationId, operationId);
  const recovered = await retryPending({ pending: { inviteId: invite.id, operationId, expiresAt: reservation.expiresAt }, api, storage: { setItem: () => {}, removeItem: () => {} } });
  assert.equal(recovered.operationId, operationId);
  assert.equal((await getInvite(f.db, invite.id)).copiedCount, 1);
});

const now = Date.parse("2026-10-13T00:00:00.000Z");
const ids = {
  invite: "22222222-2222-4222-8222-222222222222",
  operation: "33333333-3333-4333-8333-333333333333",
  other: "44444444-4444-4444-8444-444444444444",
};

test("confirmed operations survive storage reads and expire after seven days", () => {
  const record = stored.rememberConfirmedOperation(ids.invite, ids.operation, now);
  assert.equal(record.confirmedAt, "2026-10-13T00:00:00.000Z");
  assert.equal(stored.confirmedOperations(now + 6 * 86400000)[ids.invite].operationId, ids.operation);
  assert.equal(stored.confirmedOperations(now + 7 * 86400000 + 1)[ids.invite], undefined);
});

test("malformed local storage cannot create eligible usage-feedback controls", () => {
  const malformed = [null, [], { inviteId: ids.invite, operationId: ids.operation },
    { inviteId: ids.invite, operationId: ids.operation, confirmedAt: "invalid" },
    { inviteId: ids.invite, operationId: "not-an-operation", confirmedAt: new Date(now).toISOString() },
    { inviteId: ids.invite, operationId: ids.operation, confirmedAt: new Date(now + 1).toISOString() },
    { inviteId: ids.other, operationId: ids.operation, confirmedAt: new Date(now).toISOString() },
    { inviteId: ids.invite, operationId: ids.operation, confirmedAt: new Date(now).toISOString(), pendingFeedback: { outcome: "failure", reason: "invented" } },
  ];
  for (const value of malformed) {
    stored.storage.setItem("muse:confirmed:" + ids.invite, JSON.stringify(value));
    assert.equal(stored.confirmedOperations(now)[ids.invite], undefined);
  }
});

test("an ambiguous failed request keeps the same outcome and note for a retry", () => {
  const record = stored.rememberConfirmedOperation(ids.invite, ids.operation, now);
  const queued = stored.queueUsageFeedback(record, { outcome: "failure", reason: "incorrect", note: "提示错误" }, now);
  assert.deepEqual(stored.confirmedOperations(now)[ids.invite].pendingFeedback, { outcome: "failure", reason: "incorrect", note: "提示错误" });
  const retry = stored.queueUsageFeedback(queued, { outcome: "success" }, now);
  assert.deepEqual(retry.pendingFeedback, { outcome: "failure", reason: "incorrect", note: "提示错误" });
});

test("repeated confirmation preserves the original eligibility clock and recorded outcome", () => {
  stored.rememberConfirmedOperation(ids.invite, ids.operation, now);
  const recorded = stored.recordUsageFeedback(ids.invite, ids.operation, { outcome: "success", recordedAt: new Date(now + 1000).toISOString() }, now + 1000);
  assert.equal(recorded?.feedback?.outcome, "success");
  assert.equal(recorded?.pendingFeedback, undefined);
  const repeated = stored.rememberConfirmedOperation(ids.invite, ids.operation, now + 86400000);
  assert.equal(repeated.confirmedAt, "2026-10-13T00:00:00.000Z");
  assert.equal(repeated.feedback?.outcome, "success");
});

test("a late response for an old operation cannot overwrite a new confirmed copy", () => {
  stored.rememberConfirmedOperation(ids.invite, ids.operation, now);
  stored.rememberConfirmedOperation(ids.invite, ids.other, now + 1000);
  const response = stored.recordUsageFeedback(ids.invite, ids.operation, { outcome: "success", recordedAt: new Date(now + 2000).toISOString() }, now + 2000);
  assert.equal(response, undefined);
  assert.equal(stored.confirmedOperations(now + 2000)[ids.invite].operationId, ids.other);
  assert.equal(stored.confirmedOperations(now + 2000)[ids.invite].feedback, undefined);
});

test("an expired server operation can be removed without deleting a newer copy", () => {
  stored.rememberConfirmedOperation(ids.invite, ids.operation, now);
  stored.rememberConfirmedOperation(ids.invite, ids.other, now + 1000);
  stored.expireConfirmedOperation(ids.invite, ids.operation, now + 1000);
  assert.equal(stored.confirmedOperations(now + 1000)[ids.invite].operationId, ids.other);
  stored.expireConfirmedOperation(ids.invite, ids.other, now + 1000);
  assert.equal(stored.confirmedOperations(now + 1000)[ids.invite], undefined);
});

test("a storage change from another tab clears stale in-memory feedback controls", () => {
  stored.rememberConfirmedOperation(ids.invite, ids.operation, now);
  stored.storage.sync("muse:confirmed:" + ids.invite, null);
  assert.equal(stored.confirmedOperations(now)[ids.invite], undefined);
});
