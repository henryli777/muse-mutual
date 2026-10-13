import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "muse-offsite-"));
  const bin = path.join(root, "bin"), destination = path.join(root, "backups");
  mkdirSync(bin);
  mkdirSync(destination, { mode: 0o700 });
  const source = path.join(root, "fixture.sqlite");
  const db = new DatabaseSync(source);
  db.exec("CREATE TABLE invites(id TEXT); CREATE TABLE claims(id TEXT); CREATE TABLE reports(id TEXT); INSERT INTO invites VALUES('retained')");
  db.close();
  const digest = createHash("sha256").update(readFileSync(source)).digest("hex");
  const remote = "/opt/muse-mutual/state/backups/muse-2026-10-13T03-00-00-000Z-12345678-1234-1234-1234-123456789012.sqlite";
  writeFileSync(path.join(bin, "ssh"), `#!${process.execPath}\nconst c=process.argv.at(-1); process.stdout.write(c.includes('sha256sum') ? process.env.MOCK_SHA+'  '+process.env.MOCK_REMOTE+'\\n' : process.env.MOCK_REMOTE+'\\n');\n`, { mode: 0o700 });
  writeFileSync(path.join(bin, "scp"), `#!${process.execPath}\nconst fs=require('node:fs'); if(process.env.MOCK_TRANSFER_FAIL)process.exit(1); fs.copyFileSync(process.env.MOCK_SOURCE,process.argv.at(-1));\n`, { mode: 0o700 });
  const key = path.join(root, "key"); writeFileSync(key, "test key path only");
  const env = { ...process.env, PATH: bin+path.delimiter+process.env.PATH, MUSE_BACKUP_HOST: "root@test.example", MUSE_BACKUP_KEY: key, MUSE_BACKUP_DEST: destination, MOCK_SOURCE: source, MOCK_SHA: digest, MOCK_REMOTE: remote };
  return { root, destination, remote, env };
}
test("offsite backup verifies immutable snapshot and saves private SQLite and manifest", () => {
  const f = fixture();
  try {
    const out = spawnSync(process.execPath, ["scripts/offsite-backup.mjs"], { env: f.env, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const name = path.basename(f.remote), filename = path.join(f.destination, name);
    assert.equal(statSync(filename).mode & 0o777, 0o600);
    assert.equal(statSync(f.destination).mode & 0o777, 0o700);
    const db = new DatabaseSync(filename, { readOnly: true });
    assert.equal(db.prepare("SELECT id FROM invites").get()?.id, "retained"); db.close();
    const manifest = JSON.parse(readFileSync(filename+".json", "utf8"));
    assert.equal(manifest.sha256, f.env.MOCK_SHA);
    assert.equal(manifest.source, "root@test.example");
    assert.equal(readdirSync(f.destination).filter(v=>v.startsWith('.incoming-')).length, 0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
for (const kind of ["checksum", "transfer"] as const) test("offsite backup rejects "+kind+" failure without leaving a trusted snapshot", () => {
  const f = fixture();
  try {
    const env = { ...f.env, ...(kind === "checksum" ? { MOCK_SHA: "0".repeat(64) } : { MOCK_TRANSFER_FAIL: "1" }) };
    const out = spawnSync(process.execPath, ["scripts/offsite-backup.mjs"], { env, encoding: "utf8" });
    assert.notEqual(out.status, 0);
    assert.deepEqual(readdirSync(f.destination), []);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
