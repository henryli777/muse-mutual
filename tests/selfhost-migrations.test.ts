import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-ignore: executable deployment helper is intentionally plain ESM.
import { migrateDatabase } from "../scripts/self-hosted-migrations.mjs";
import { openSqliteD1 } from "../lib/server/sqlite-d1.ts";
import { createInvite, getInvite } from "../lib/server/invite-repository.ts";
import { reserveClaim, confirmClaim } from "../lib/server/claim-repository.ts";
import { submitUsageFeedback } from "../lib/server/usage-repository.ts";
test("selfhost migration restart preserves data and rejects changed applied migrations", () => {
  const root = mkdtempSync(path.join(tmpdir(), "muse-migration-"));
  const filename = path.join(root, "muse.sqlite");
  const migrations = path.join(root, "migrations");
  mkdirSync(migrations);
  const sql = path.join(migrations, "0000.sql");
  writeFileSync(
    sql,
    "CREATE TABLE example(id INTEGER PRIMARY KEY, value TEXT)",
  );
  try {
    migrateDatabase(filename, migrations);
    const db = new DatabaseSync(filename);
    db.prepare("INSERT INTO example VALUES(1,'retained')").run();
    db.close();
    migrateDatabase(filename, migrations);
    const again = new DatabaseSync(filename);
    assert.equal(
      again.prepare("SELECT value FROM example").get()?.value,
      "retained",
    );
    again.close();
    writeFileSync(sql, "CREATE TABLE changed(id INTEGER)");
    assert.throws(
      () => migrateDatabase(filename, migrations),
      /Applied migration changed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("usage migration upgrades an existing database and keeps feedback across restarts", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "muse-usage-upgrade-"));
  const filename = path.join(root, "muse.sqlite");
  const migrations = path.join(root, "migrations");
  mkdirSync(migrations);
  const original = "0000_kind_grandmaster.sql";
  copyFileSync(path.join("drizzle", original), path.join(migrations, original));
  try {
    migrateDatabase(filename, migrations);
    const legacy = new DatabaseSync(filename);
    legacy.prepare("INSERT INTO invites(id,code,initial_remaining,remaining,owner_hash,created_at,updated_at) VALUES('legacy','RETained',30,29,'owner',100,100)").run();
    legacy.close();
    for (const name of readdirSync("drizzle").filter((name) => name.endsWith(".sql") && name !== original))
      copyFileSync(path.join("drizzle", name), path.join(migrations, name));
    migrateDatabase(filename, migrations);
    const upgraded = openSqliteD1(filename);
    const id = crypto.randomUUID();
    let newInviteId: string;
    try {
      const old = await getInvite(upgraded.db, "legacy");
      assert.equal(old.remaining, 29);
      assert.equal(old.code, "RETained");
      assert.equal(old.lastVerifiedAt, null);
      const created = await createInvite(upgraded.db, { code: "upgrade-new", nickname: "", remaining: 1 }, "owner", Math.floor(Date.now() / 1000));
      newInviteId = created.id;
      await reserveClaim(upgraded.db, { inviteId: created.id, operationId: id, visitorHash: "visitor" });
      await confirmClaim(upgraded.db, id, "visitor");
      const results = await Promise.all(Array.from({ length: 10 }, () => submitUsageFeedback(upgraded.db, id, "visitor", { outcome: "success" })));
      assert.equal(results[0].invite.successCount, 1);
      assert.equal(results[0].invite.remaining, 0);
    } finally {
      upgraded.close();
    }
    migrateDatabase(filename, migrations);
    const restarted = openSqliteD1(filename);
    try {
      const saved = await getInvite(restarted.db, newInviteId);
      assert.equal(saved.remaining, 0);
      assert.equal(saved.copiedCount, 1);
      assert.equal(saved.successCount, 1);
      assert.ok(saved.lastVerifiedAt);
      const retried = await submitUsageFeedback(restarted.db, id, "visitor", { outcome: "success" });
      assert.equal(retried.feedback.recordedAt, saved.lastVerifiedAt);
      assert.equal(retried.invite.successCount, 1);
      assert.equal((await getInvite(restarted.db, "legacy")).remaining, 29);
    } finally {
      restarted.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
