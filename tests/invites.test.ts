import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/sqlite-d1.ts";
import {
  createInvite,
  listInvites,
  updateRemaining,
  getInvite,
  listInvitePage,
} from "../lib/server/invite-repository.ts";
const input = { code: "AbC", nickname: "Lin", remaining: 30 };
test("duplicate_code_keeps_original", async () => {
  const { db, now } = fixture();
  const a = await createInvite(db, input, "owner", now());
  assert.equal(a.remaining, 30);
  await assert.rejects(
    () => createInvite(db, { ...input, code: " AbC " }, "other", now()),
    /已分享/,
  );
  assert.equal((await listInvites(db)).length, 1);
});
test("latest_uses_creation_time", async () => {
  const { db, now, advance } = fixture();
  const a = await createInvite(db, input, "owner", now());
  advance(2);
  const b = await createInvite(db, { ...input, code: "B" }, "owner", now());
  advance(2);
  await updateRemaining(db, a.id, "owner", 12, now());
  const list = await listInvites(db);
  assert.deepEqual(
    list.map((v) => v.id),
    [b.id, a.id],
  );
  assert.equal(list[1].createdAt, a.createdAt);
  assert.notEqual(list[1].updatedAt, a.updatedAt);
});
test("owner_cannot_edit_other_record", async () => {
  const { db, now } = fixture();
  const a = await createInvite(db, input, "owner", now());
  await assert.rejects(
    () => updateRemaining(db, a.id, "other", 0, now()),
    /管理凭据/,
  );
  assert.equal((await getInvite(db, a.id)).remaining, 30);
});
test("owner_cannot_undercut_reservations", async () => {
  const { db, sqlite, now } = fixture();
  const a = await createInvite(db, input, "owner", now());
  sqlite
    .prepare("INSERT INTO claims VALUES(?,?,?,0,'reserved',?,?,NULL)")
    .run("op", a.id, "visitor", now(), now() + 90);
  await assert.rejects(
    () => updateRemaining(db, a.id, "owner", 0, now()),
    /预留/,
  );
  assert.equal((await getInvite(db, a.id)).remaining, 30);
});
test("public_dto_has_no_secrets and edits keep review status", async () => {
  const { db, sqlite, now } = fixture();
  const a = await createInvite(db, input, "secret-hash", now());
  sqlite
    .prepare("INSERT INTO reports VALUES(?,?,?,?,?,?,0)")
    .run("r", a.id, "visitor", "incorrect", "private personal note", now());
  sqlite
    .prepare("UPDATE invites SET review_status='pending' WHERE id=?")
    .run(a.id);
  const out = await updateRemaining(db, a.id, "secret-hash", 12, now());
  assert.equal(out.reviewStatus, "pending");
  assert.equal(out.reportCount, 1);
  assert.deepEqual(out.reportReasons, ["incorrect"]);
  assert.ok(!JSON.stringify(out).includes("secret-hash"));
  assert.ok(!JSON.stringify(out).includes("private personal note"));
});
test("empty lists and exhausted filters reflect shared stored counts", async () => {
  const { db, now } = fixture();
  assert.deepEqual(await listInvites(db), []);
  await createInvite(db, { ...input, remaining: 0 }, "o", now());
  assert.equal((await listInvites(db, { filter: "available" })).length, 0);
  assert.equal((await listInvites(db, { filter: "exhausted" })).length, 1);
});
test("server filtering reaches older available codes and pagination reaches beyond 200", async () => {
  const { db, now, advance } = fixture();
  const older = await createInvite(
    db,
    { ...input, code: "older-available" },
    "o",
    now(),
  );
  for (let i = 0; i < 205; i++) {
    advance(1);
    await createInvite(
      db,
      { code: "exhausted-" + i, nickname: "", remaining: 0 },
      "o",
      now(),
    );
  }
  const available = await listInvitePage(db, {
    filter: "available",
    limit: 50,
  });
  assert.deepEqual(
    available.invites.map((v) => v.id),
    [older.id],
  );
  assert.equal(available.availableTotal, 1);
  assert.equal(available.total, 1);
  assert.equal(available.nextOffset, null);
  const last = await listInvitePage(db, {
    filter: "all",
    limit: 50,
    offset: 200,
  });
  assert.equal(last.invites.length, 6);
  assert.equal(last.invites.at(-1)?.id, older.id);
  assert.equal(last.total, 206);
  const first = await listInvitePage(db, { filter: "all", limit: 50 });
  assert.equal(first.nextOffset, 50);
});
