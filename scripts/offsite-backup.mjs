import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, lstatSync, chmodSync, readFileSync, writeFileSync, linkSync, rmSync } from "node:fs";
import path from "node:path";

// Pull only consistent, immutable database snapshots. Runtime secrets remain on
// the source server. Configure the destination outside the source checkout.
const host = process.env.MUSE_BACKUP_HOST;
const key = process.env.MUSE_BACKUP_KEY;
const destination = process.env.MUSE_BACKUP_DEST;
if (!host || !/^(?:[a-z_][a-z0-9_-]*@)?[a-z0-9][a-z0-9.-]*$/i.test(host))
  throw new Error("MUSE_BACKUP_HOST must be an SSH host or user@host");
if (!key || !path.isAbsolute(key) || !lstatSync(key).isFile())
  throw new Error("MUSE_BACKUP_KEY must be an existing absolute key path");
if (!destination || !path.isAbsolute(destination))
  throw new Error("MUSE_BACKUP_DEST must be an absolute directory");
mkdirSync(destination, { recursive: true, mode: 0o700 });
if (!lstatSync(destination).isDirectory() || lstatSync(destination).isSymbolicLink())
  throw new Error("Backup destination must be a real directory");
chmodSync(destination, 0o700);
const options = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ProxyJump=none", "-o", "ConnectTimeout=30", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-i", key];
function run(command, args) {
  const out = spawnSync(command, args, { encoding: "utf8", timeout: 120000, maxBuffer: 1048576 });
  if (out.error || out.status !== 0)
    throw new Error(command+" failed; no verified backup was accepted");
  return out.stdout.trim();
}
function digest(filename) {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}
const remote = run("ssh", [...options, host, "/opt/muse-mutual/current/deploy/self-hosted/backup.sh"]);
if (!/^\/opt\/muse-mutual\/state\/backups\/muse-[0-9TZ.-]+-[a-f0-9-]{36}\.sqlite$/.test(remote))
  throw new Error("Server did not return an expected immutable snapshot path");
const result = run("ssh", [...options, host, "sha256sum "+remote]);
const match = /^([a-f0-9]{64})\s+(.+)$/.exec(result);
if (!match || match[2] !== remote) throw new Error("Invalid snapshot checksum response");
const temporary = mkdtempSync(path.join(destination, ".incoming-"));
try {
  const incoming = path.join(temporary, "snapshot.sqlite");
  run("scp", [...options, host+":"+remote, incoming]);
  chmodSync(incoming, 0o600);
  if (digest(incoming) !== match[1]) throw new Error("Snapshot checksum mismatch");
  const db = new DatabaseSync(incoming, { readOnly: true });
  try {
    if (db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Snapshot integrity check failed");
    for (const table of ["invites", "claims", "reports"])
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
        throw new Error("Snapshot is missing an application table");
  } finally { db.close(); }
  const target = path.join(destination, path.basename(remote));
  try { linkSync(incoming, target); }
  catch (error) {
    if (error.code !== "EEXIST" || lstatSync(target).isSymbolicLink() || digest(target) !== match[1]) throw error;
  }
  writeFileSync(target+".json", JSON.stringify({ source: host, snapshot: path.basename(remote), sha256: match[1], receivedAt: new Date().toISOString() }, null, 2)+"\n", { mode: 0o600, flag: "wx" });
  console.log(target);
} finally { rmSync(temporary, { recursive: true, force: true }); }
