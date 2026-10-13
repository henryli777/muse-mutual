#!/bin/sh
# Run on the Docker host. VACUUM INTO creates a consistent snapshot with WAL.
set -eu

docker exec -i muse-mutual node --input-type=module - <<'JS'
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const source = '/data/muse.sqlite';
const directory = '/data/backups';
mkdirSync(directory, { recursive: true, mode: 0o700 });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const name = `muse-${timestamp}-${randomUUID()}.sqlite`;
const destination = join(directory, name);
const sqlite = new DatabaseSync(source, { readOnly: true });
try {
  sqlite.exec('PRAGMA busy_timeout=5000');
  sqlite.prepare('VACUUM INTO ?').run(destination);
} finally {
  sqlite.close();
}
chmodSync(destination, 0o600);
const snapshot = new DatabaseSync(destination, { readOnly: true });
try {
  if (snapshot.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') {
    throw new Error('SQLite backup integrity check failed');
  }
} finally {
  snapshot.close();
}
console.log(`/opt/muse-mutual/state/backups/${name}`);
JS
