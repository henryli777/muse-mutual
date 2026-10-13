import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createSqliteD1, openSqliteD1 } from "../lib/server/sqlite-d1.ts";
import { createInvite, getInvite } from "../lib/server/invite-repository.ts";
import { reserveClaim, confirmClaim } from "../lib/server/claim-repository.ts";

test("self-hosted SQLite persists rows and enables durability pragmas", async () => {
  const directory = mkdtempSync(join(tmpdir(), "muse-sqlite-"));
  const filename = join(directory, "muse.sqlite");
  try {
    const first = openSqliteD1(filename);
    assert.equal(
      first.sqlite.prepare("PRAGMA journal_mode").get()?.journal_mode,
      "wal",
    );
    assert.equal(
      first.sqlite.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      1,
    );
    assert.equal(
      first.sqlite.prepare("PRAGMA busy_timeout").get()?.timeout,
      5000,
    );
    first.sqlite.exec(
      "CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)",
    );
    await first.db
      .prepare("INSERT INTO notes (text) VALUES (?)")
      .bind("persisted")
      .run();
    first.close();

    const reopened = openSqliteD1(filename);
    try {
      assert.equal(
        await reopened.db
          .prepare("SELECT text FROM notes WHERE id=?")
          .bind(1)
          .first("text"),
        "persisted",
      );
      assert.equal(
        await reopened.db
          .prepare("SELECT text FROM notes WHERE id=?")
          .bind(2)
          .first(),
        null,
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("self-hosted SQLite enforces foreign keys and rolls back a failed batch", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = createSqliteD1(sqlite);
  try {
    sqlite.exec(
      "CREATE TABLE parents (id INTEGER PRIMARY KEY); CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parents(id))",
    );
    await assert.rejects(
      db.prepare("INSERT INTO children VALUES (?, ?)").bind(1, 99).run(),
      /FOREIGN KEY/,
    );
    await assert.rejects(
      db.batch([
        db.prepare("INSERT INTO parents VALUES (?)").bind(1),
        db.prepare("INSERT INTO children VALUES (?, ?)").bind(1, 99),
      ]),
      /FOREIGN KEY/,
    );
    assert.equal(
      await db.prepare("SELECT count(*) AS n FROM parents").first("n"),
      0,
    );
    await db.batch([
      db.prepare("INSERT INTO parents VALUES (?)").bind(1),
      db.prepare("INSERT INTO children VALUES (?, ?)").bind(1, 1),
    ]);
    assert.equal(
      await db.prepare("SELECT count(*) AS n FROM children").first("n"),
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("self-hosted SQLite returns changes for each statement without leaking previous writes", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = createSqliteD1(sqlite);
  try {
    sqlite.exec(
      "CREATE TABLE counters (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)",
    );
    const inserted = await db
      .prepare("INSERT INTO counters VALUES (?, ?)")
      .bind(1, 30)
      .run();
    assert.equal(inserted.meta.changes, 1);
    const results = await db.batch([
      db.prepare("UPDATE counters SET n=n-1 WHERE id=?").bind(1),
      db.prepare("UPDATE counters SET n=n-1 WHERE id=?").bind(999),
      db.prepare("SELECT n FROM counters WHERE id=?").bind(1),
      db.prepare("UPDATE counters SET n=n-1 WHERE id=? RETURNING n").bind(1),
    ]);
    assert.deepEqual(
      results.map((result) => result.meta.changes),
      [1, 0, 0, 1],
    );
    assert.equal((results[2].results[0] as { n: number }).n, 29);
    assert.equal((results[3].results[0] as { n: number }).n, 28);
    assert.equal(
      (await db.prepare("SELECT n FROM counters").all()).meta.changes,
      0,
    );
    const selectRun = await db.prepare("SELECT n FROM counters").run();
    assert.equal(selectRun.meta.changes, 0);
  } finally {
    sqlite.close();
  }
});

test("self-hosted SQLite binding preserves an unbound statement", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = createSqliteD1(sqlite);
  try {
    const statement = db.prepare("SELECT ? AS value");
    const first = statement.bind("one");
    const second = statement.bind("two");
    assert.equal(await first.first("value"), "one");
    assert.equal(await second.first("value"), "two");
    assert.equal(await first.first("value"), "one");
  } finally {
    sqlite.close();
  }
});

test("self-hosted SQLite rejects statements from a different connection before writing", async () => {
  const one = new DatabaseSync(":memory:"),
    two = new DatabaseSync(":memory:");
  const db = createSqliteD1(one),
    other = createSqliteD1(two);
  try {
    one.exec("CREATE TABLE counters (n INTEGER)");
    await assert.rejects(
      db.batch([
        db.prepare("INSERT INTO counters VALUES (1)"),
        other.prepare("SELECT 1"),
      ]),
      /connection/,
    );
    assert.equal(
      await db.prepare("SELECT count(*) AS n FROM counters").first("n"),
      0,
    );
  } finally {
    one.close();
    two.close();
  }
});

test("repositories preserve one last-slot winner and idempotent confirmation on production adapter", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = createSqliteD1(sqlite);
  try {
    for (const file of readdirSync("drizzle")
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      sqlite.exec(readFileSync(join("drizzle", file), "utf8"));
    }
    const invite = await createInvite(
      db,
      { code: "SELFHOST-TEST", nickname: "", remaining: 1 },
      "owner",
      Math.floor(Date.now() / 1000),
    );
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) => {
        const visitorHash = "visitor-" + index;
        return reserveClaim(db, {
          inviteId: invite.id,
          operationId: crypto.randomUUID(),
          visitorHash,
        }).then((claim) => ({ ...claim, visitorHash }));
      }),
    );
    const winners = outcomes.filter((result) => result.status === "fulfilled");
    assert.equal(winners.length, 1);
    const winner = winners[0];
    assert.ok(winner.status === "fulfilled");
    const confirmations = await Promise.all(
      Array.from({ length: 10 }, () =>
        confirmClaim(db, winner.value.operationId, winner.value.visitorHash),
      ),
    );
    assert.equal(confirmations.filter((result) => result.counted).length, 1);
    const updated = await getInvite(db, invite.id);
    assert.equal(updated.remaining, 0);
    assert.equal(updated.copiedCount, 1);
  } finally {
    sqlite.close();
  }
});
