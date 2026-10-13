import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = join(dirname(fileURLToPath(import.meta.url)), 'deploy-image.sh');
const revision = 'a'.repeat(40);
const image = `muse-mutual:git-${revision}`;
const imageId = `sha256:${'b'.repeat(64)}`;
const previousImage = `sha256:${'c'.repeat(64)}`;

function fixture(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muse-image-deploy-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldRelease = join(root, 'releases', 'previous');
  const release = join(root, 'releases', revision);
  const bin = join(root, 'bin');
  mkdirSync(oldRelease, { recursive: true });
  mkdirSync(join(release, 'deploy', 'self-hosted'), { recursive: true });
  mkdirSync(join(root, 'state'));
  mkdirSync(bin);
  writeFileSync(join(root, 'state', 'muse.sqlite'), 'production database sentinel');
  symlinkSync(oldRelease, join(root, 'current'));
  writeFileSync(join(release, 'deploy', 'self-hosted', 'compose.yaml'), 'services: {}\n');
  const archive = Buffer.from('prebuilt image fixture');
  writeFileSync(join(release, 'image.tar.gz'), archive);
  writeFileSync(join(release, 'image.tar.gz.sha256'), `${createHash('sha256').update(archive).digest('hex')}\n`);
  for (const [name, value] of Object.entries({ 'revision.txt': revision, 'image-reference.txt': image, 'image-id.txt': imageId, 'platform.txt': 'linux/amd64' })) {
    writeFileSync(join(release, name), `${value}\n`);
  }
  const log = join(root, 'docker.jsonl');
  const dockerStub = join(root, 'docker-stub.mjs');
  writeFileSync(dockerStub, `
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_LOG, JSON.stringify({ args, image: process.env.MUSE_IMAGE }) + '\\n');
if (args[0] === 'container' && args[1] === 'inspect') {
  console.log(args[3] === '{{.Image}}' ? ${JSON.stringify(previousImage)} : 'healthy');
} else if (args[0] === 'image' && args[1] === 'inspect') {
  const format = args[3];
  if (format === '{{.Id}}') console.log(${JSON.stringify(imageId)});
  else if (format === '{{.Os}}/{{.Architecture}}') console.log('linux/amd64');
  else console.log(process.env.TEST_WRONG_LABEL ? 'd'.repeat(40) : ${JSON.stringify(revision)});
} else if (args[0] === 'compose' && process.env.MUSE_IMAGE === ${JSON.stringify(imageId)} && process.env.TEST_FAIL_HEALTH) {
  process.exit(1);
}
`);
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexec "$TEST_NODE" "$TEST_DOCKER_STUB" "$@"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const run = (expected = revision) => spawnSync('bash', [script, release, expected], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MUSE_DEPLOY_ROOT: root,
      TEST_NODE: process.execPath, TEST_DOCKER_STUB: dockerStub, TEST_LOG: log,
      TEST_FAIL_HEALTH: options.failHealth ? '1' : '', TEST_WRONG_LABEL: options.wrongLabel ? '1' : '' },
  });
  const calls = () => {
    try { return readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  return { root, release, oldRelease, run, calls };
}

test('rejects a changed image archive before calling Docker', t => {
  const f = fixture(t);
  writeFileSync(join(f.release, 'image.tar.gz'), 'corrupted archive');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum/i);
  assert.equal(f.calls().length, 0);
  assert.equal(realpathSync(join(f.root, 'current')), f.oldRelease);
});

test('rejects a release from a different expected commit before calling Docker', t => {
  const f = fixture(t);
  const result = f.run('d'.repeat(40));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /revision/i);
  assert.equal(f.calls().length, 0);
});

test('rejects an image whose OCI revision label does not match the artifact', t => {
  const f = fixture(t, { wrongLabel: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /revision/i);
  assert.equal(f.calls().filter(call => call.args[0] === 'compose').length, 0);
  assert.equal(realpathSync(join(f.root, 'current')), f.oldRelease);
});

test('rolls back to the exact previous image after failed health and preserves data', t => {
  const f = fixture(t, { failHealth: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  const compose = f.calls().filter(call => call.args[0] === 'compose');
  assert.deepEqual(compose.map(call => call.image), [imageId, previousImage]);
  assert.ok(compose.every(call => call.args.includes('--no-build')));
  assert.equal(realpathSync(join(f.root, 'current')), f.oldRelease);
  assert.equal(readFileSync(join(f.root, 'state', 'muse.sqlite'), 'utf8'), 'production database sentinel');
});

test('switches current only after health succeeds and records the immutable image', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(realpathSync(join(f.root, 'current')), f.release);
  assert.equal(readFileSync(join(f.release, 'deploy-image.env'), 'utf8'), `MUSE_IMAGE=${imageId}\n`);
  assert.equal(readFileSync(join(f.release, 'deployed-commit.txt'), 'utf8'), `${revision}\n`);
  const compose = f.calls().filter(call => call.args[0] === 'compose');
  assert.equal(compose.length, 1);
  assert.equal(compose[0].image, imageId);
  assert.ok(compose[0].args.includes('--no-build'));
  assert.equal(readFileSync(join(f.root, 'state', 'muse.sqlite'), 'utf8'), 'production database sentinel');
});
