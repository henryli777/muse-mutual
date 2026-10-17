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
test("operator pin state is public and cannot be set by a submission", async () => {
  const { db, sqlite, now } = fixture();
  const submission = { ...input, pinned: true };
  const created = await createInvite(
    db,
    submission,
    "owner",
    now(),
  );
  assert.equal(created.pinned, false);
  sqlite.prepare("UPDATE invites SET pinned=1 WHERE id=?").run(created.id);
  assert.equal((await getInvite(db, created.id)).pinned, true);
  const edited = await updateRemaining(db, created.id, "owner", 12, now());
  assert.equal(edited.pinned, true);
  assert.equal(edited.remaining, 12);
  sqlite.prepare("UPDATE invites SET pinned=0 WHERE id=?").run(created.id);
  assert.equal((await getInvite(db, created.id)).pinned, false);
  assert.throws(
    () => sqlite.prepare("UPDATE invites SET pinned=2 WHERE id=?").run(created.id),
    /CHECK constraint failed/,
  );
});
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

test("an older operator pin precedes review priority and pagination in both sorts", async () => {
  const { db, sqlite, now, advance } = fixture();
  const older = await createInvite(
    db,
    { ...input, code: "old-pin", remaining: 1 },
    "owner",
    now(),
  );
  sqlite.prepare("UPDATE invites SET pinned=1, review_status='pending' WHERE id=?").run(older.id);
  let newestId = "";
  for (let i = 0; i < 205; i++) {
    advance(1);
    const created = await createInvite(
      db,
      { ...input, code: "newer-" + i },
      "owner",
      now(),
    );
    newestId = created.id;
  }
  for (const sort of ["latest", "remaining"]) {
    const first = await listInvitePage(db, { sort, filter: "all", limit: 50 });
    assert.equal(first.invites[0].id, older.id, sort);
    assert.equal(first.invites[0].pinned, true);
    assert.equal(first.invites[1].id, newestId);
    assert.equal(first.total, 206);
    assert.equal(first.availableTotal, 206);
    assert.equal(first.nextOffset, 50);
    const pages = [...first.invites];
    for (const offset of [50, 100, 150, 200]) {
      const page = await listInvitePage(db, { sort, filter: "all", limit: 50, offset });
      pages.push(...page.invites);
      assert.equal(page.invites.some((invite) => invite.id === older.id), false);
    }
    assert.equal(pages.length, 206);
    assert.equal(new Set(pages.map((invite) => invite.id)).size, 206);
  }
  sqlite.prepare("UPDATE invites SET pinned=0 WHERE id=?").run(older.id);
  for (const sort of ["latest", "remaining"]) {
    const first = await listInvitePage(db, { sort, filter: "all", limit: 50 });
    assert.equal(first.invites[0].id, newestId);
    const last = await listInvitePage(db, { sort, filter: "all", limit: 50, offset: 200 });
    assert.equal(last.invites.at(-1)?.id, older.id);
    assert.equal(last.invites.at(-1)?.pinned, false);
  }
});

test("multiple pins retain review priority and the selected sort within their group", async () => {
  const { db, sqlite, now, advance } = fixture();
  const pending = await createInvite(db, { ...input, code: "pin-pending" }, "owner", now());
  advance(1);
  const higher = await createInvite(db, { ...input, code: "pin-higher", remaining: 10 }, "owner", now());
  advance(1);
  const newer = await createInvite(db, { ...input, code: "pin-newer", remaining: 3 }, "owner", now());
  advance(1);
  const ordinary = await createInvite(db, { ...input, code: "ordinary" }, "owner", now());
  sqlite.prepare("UPDATE invites SET pinned=1 WHERE id IN (?,?,?)").run(pending.id, higher.id, newer.id);
  sqlite.prepare("UPDATE invites SET review_status='pending' WHERE id=?").run(pending.id);
  assert.deepEqual(
    (await listInvites(db, { sort: "latest" })).map((invite) => invite.id),
    [newer.id, higher.id, pending.id, ordinary.id],
  );
  assert.deepEqual(
    (await listInvites(db, { sort: "remaining" })).map((invite) => invite.id),
    [higher.id, newer.id, pending.id, ordinary.id],
  );
});

test("pins preserve filters and available totals without changing stored quotas", async () => {
  const { db, sqlite, now, advance } = fixture();
  const invalid = await createInvite(db, { ...input, code: "pin-invalid" }, "owner", now());
  advance(1);
  const exhausted = await createInvite(db, { ...input, code: "pin-exhausted", remaining: 0 }, "owner", now());
  advance(1);
  const pending = await createInvite(db, { ...input, code: "pin-pending", remaining: 2 }, "owner", now());
  advance(1);
  const ordinary = await createInvite(db, { ...input, code: "ordinary", remaining: 5 }, "owner", now());
  sqlite.prepare("UPDATE invites SET pinned=1 WHERE id IN (?,?,?)").run(invalid.id, exhausted.id, pending.id);
  sqlite.prepare("UPDATE invites SET review_status='invalid' WHERE id=?").run(invalid.id);
  sqlite.prepare("UPDATE invites SET review_status='pending' WHERE id=?").run(pending.id);
  for (const sort of ["latest", "remaining"]) {
    const available = await listInvitePage(db, { sort, filter: "available" });
    assert.deepEqual(available.invites.map((invite) => invite.id), [pending.id, ordinary.id]);
    assert.equal(available.total, 2);
    assert.equal(available.availableTotal, 2);
    assert.deepEqual(available.invites.map((invite) => [invite.remaining, invite.available, invite.copiedCount]), [[2, 2, 0], [5, 5, 0]]);
    const exhaustedPage = await listInvitePage(db, { sort, filter: "exhausted" });
    assert.deepEqual(exhaustedPage.invites.map((invite) => invite.id), [exhausted.id]);
    assert.equal(exhaustedPage.total, 1);
    assert.equal(exhaustedPage.availableTotal, 2);
    const pendingPage = await listInvitePage(db, { sort, filter: "pending" });
    assert.deepEqual(pendingPage.invites.map((invite) => invite.id), [pending.id]);
    assert.equal(pendingPage.total, 1);
    assert.equal(pendingPage.availableTotal, 2);
    const all = await listInvitePage(db, { sort, filter: "all" });
    assert.equal(all.total, 4);
    assert.equal(all.availableTotal, 2);
    assert.equal(all.invites.some((invite) => invite.id === invalid.id), true);
  }
});
