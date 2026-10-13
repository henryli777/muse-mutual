import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-ignore: executable deployment helper is intentionally plain ESM.
import { migrateDatabase } from "../scripts/self-hosted-migrations.mjs";
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
