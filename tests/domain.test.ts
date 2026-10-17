import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSubmission,
  validateRemaining,
  inviteStatus,
  compareInvites,
} from "../lib/domain.ts";

test("submission uses 30 by default and preserves the code case", () => {
  assert.deepEqual(
    validateSubmission({ code: " AbC-42 ", nickname: " Lin " }),
    { code: "AbC-42", nickname: "Lin", remaining: 30 },
  );
});
test("remaining accepts both boundaries and rejects non-integer or out of range input", () => {
  assert.equal(validateRemaining(0), 0);
  assert.equal(validateRemaining(30), 30);
  for (const n of [-1, 31, 1.5, "12", null])
    assert.throws(() => validateRemaining(n), /次数/);
});
test("submission rejects empty and excessive text without assuming an official code format", () => {
  for (const code of ["", "  ", "a".repeat(201)])
    assert.throws(() => validateSubmission({ code }), /邀请码/);
  assert.throws(
    () => validateSubmission({ code: "A", nickname: "a".repeat(41) }),
    /昵称/,
  );
  assert.equal(
    validateSubmission({ code: "<b>share</b>" }).code,
    "<b>share</b>",
  );
});
test("count and moderation statuses preserve exhaustion priority", () => {
  assert.equal(
    inviteStatus({ remaining: 30, reviewStatus: "normal" }),
    "available",
  );
  assert.equal(inviteStatus({ remaining: 3, reviewStatus: "normal" }), "low");
  assert.equal(
    inviteStatus({ remaining: 0, reviewStatus: "pending" }),
    "exhausted",
  );
  assert.equal(
    inviteStatus({ remaining: 12, reviewStatus: "pending" }),
    "pending",
  );
  assert.equal(
    inviteStatus({ remaining: 12, reviewStatus: "invalid" }),
    "invalid",
  );
});
test("client ordering keeps an older pinned invite ahead of newer and higher-quota invites", () => {
  const oldPinned = { pinned: true, reviewStatus: "normal" as const, remaining: 1, createdAt: "2026-10-13T00:00:00Z" };
  const recent = { pinned: false, reviewStatus: "normal" as const, remaining: 30, createdAt: "2026-10-17T00:00:00Z" };
  for (const sort of ["latest", "remaining"]) {
    assert.deepEqual([recent, oldPinned].sort((a, b) => compareInvites(a, b, sort)), [oldPinned, recent]);
    assert.ok(compareInvites({ ...oldPinned, pinned: false }, recent, sort) > 0);
  }
});
