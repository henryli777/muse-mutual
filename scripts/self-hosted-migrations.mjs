import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
export function migrateDatabase(filename, migrationDir) {
  if (!filename || !path.isAbsolute(filename))
    throw new Error("MUSE_DB_PATH must be an absolute file path");
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS muse_schema_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const name of readdirSync(migrationDir)
        .filter((v) => v.endsWith(".sql"))
        .sort()) {
        const sql = readFileSync(path.join(migrationDir, name), "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        const applied = db
          .prepare("SELECT checksum FROM muse_schema_migrations WHERE name=?")
          .get(name);
        if (applied) {
          if (applied.checksum !== checksum)
            throw new Error("Applied migration changed: " + name);
          continue;
        }
        db.exec(sql);
        db.prepare(
          "INSERT INTO muse_schema_migrations VALUES(?,?,unixepoch('now'))",
        ).run(name, checksum);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } finally {
    db.close();
  }
}
