import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = join(dirname(fileURLToPath(import.meta.url)), 'deploy-image.sh');
const archiveVerifier = join(dirname(fileURLToPath(import.meta.url)), 'verify-image-archive.py');
const revision = 'a'.repeat(40);
const image = `muse-mutual:git-${revision}`;
const config = JSON.stringify({ architecture: 'amd64', os: 'linux', config: { Labels: { 'org.opencontainers.image.revision': revision } }, rootfs: { type: 'layers', diff_ids: [] } });
const imageId = `sha256:${createHash('sha256').update(config).digest('hex')}`;
const manifest = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
  config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: imageId, size: Buffer.byteLength(config) }, layers: [] });
const manifestId = `sha256:${createHash('sha256').update(manifest).digest('hex')}`;
const previousImage = `sha256:${'c'.repeat(64)}`;

function fixture(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muse-image-deploy-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldRelease = join(root, 'releases', 'previous');
  const release = join(root, 'releases', revision);
  const bin = join(root, 'bin');
  const tooling = join(root, 'deploy-tools', 'verified-tooling');
  mkdirSync(oldRelease, { recursive: true });
  mkdirSync(join(release, 'deploy', 'self-hosted'), { recursive: true });
  mkdirSync(join(root, 'state'));
  mkdirSync(bin);
  mkdirSync(tooling, { recursive: true });
  const deploymentScript = join(tooling, 'deploy-image.sh');
  writeFileSync(deploymentScript, readFileSync(script));
  writeFileSync(join(tooling, 'verify-image-archive.py'), readFileSync(archiveVerifier));
  writeFileSync(join(root, 'state', 'muse.sqlite'), 'production database sentinel');
  symlinkSync(oldRelease, join(root, 'current'));
  writeFileSync(join(release, 'deploy', 'self-hosted', 'compose.yaml'), 'services: {}\n');
  const files = {
    [`blobs/sha256/${imageId.slice(7)}`]: config,
    [`blobs/sha256/${manifestId.slice(7)}`]: manifest,
    'manifest.json': JSON.stringify([{ Config: `blobs/sha256/${imageId.slice(7)}`, RepoTags: [image], Layers: [] }]),
    'oci-layout': JSON.stringify({ imageLayoutVersion: '1.0.0' }),
    'index.json': JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{
      mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: manifestId, size: Buffer.byteLength(manifest),
      annotations: { 'io.containerd.image.name': `docker.io/library/${image}`, 'org.opencontainers.image.ref.name': image.split(':')[1] },
    }] }),
  };
  const archivePath = join(release, 'image.tar.gz');
  const createArchive = spawnSync('python3', ['-c', `
import io, json, sys, tarfile
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    for name, value in json.loads(sys.argv[2]).items():
        data = value.encode()
        info = tarfile.TarInfo(name)
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
`, archivePath, JSON.stringify(files)], { encoding: 'utf8' });
  assert.equal(createArchive.status, 0, createArchive.stderr);
  const archive = readFileSync(archivePath);
  writeFileSync(join(release, 'image.tar.gz.sha256'), `${createHash('sha256').update(archive).digest('hex')}\n`);
  for (const [name, value] of Object.entries({ 'revision.txt': revision, 'image-reference.txt': image, 'image-id.txt': imageId, 'platform.txt': 'linux/amd64' })) {
    writeFileSync(join(release, name), `${value}\n`);
  }
  if (options.manifestId !== undefined) writeFileSync(join(release, 'image-manifest-id.txt'), `${options.manifestId}\n`);
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
  if (format === '{{.Id}}') console.log(${JSON.stringify(options.loadedId ?? imageId)});
  else if (format === '{{.Os}}/{{.Architecture}}') console.log('linux/amd64');
  else console.log(process.env.TEST_WRONG_LABEL ? 'd'.repeat(40) : ${JSON.stringify(revision)});
} else if (args[0] === 'compose' && process.env.MUSE_IMAGE !== ${JSON.stringify(previousImage)} && process.env.TEST_FAIL_HEALTH) {
  process.exit(1);
}
`);
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexec "$TEST_NODE" "$TEST_DOCKER_STUB" "$@"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const run = (expected = revision) => spawnSync('bash', [deploymentScript, release, expected], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MUSE_DEPLOY_ROOT: root,
      TEST_NODE: process.execPath, TEST_DOCKER_STUB: dockerStub, TEST_LOG: log,
      TEST_FAIL_HEALTH: options.failHealth ? '1' : '', TEST_WRONG_LABEL: options.wrongLabel ? '1' : '',
      MUSE_SKIP_IMAGE_LOAD: options.skipLoad ? '1' : '' },
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

test('accepts the archive manifest identity on containerd and persists that loaded identity', t => {
  const f = fixture(t, { loadedId: manifestId, manifestId });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(realpathSync(join(f.root, 'current')), f.release);
  assert.equal(readFileSync(join(f.release, 'deploy-image.env'), 'utf8'), `MUSE_IMAGE=${manifestId}\n`);
  assert.equal(f.calls().find(call => call.args[0] === 'compose').image, manifestId);
});

test('rejects an unrelated loaded image even when manifest metadata is provided', t => {
  const f = fixture(t, { loadedId: `sha256:${'f'.repeat(64)}`, manifestId });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /image ID/i);
  assert.equal(f.calls().filter(call => call.args[0] === 'compose').length, 0);
});

test('rejects invalid optional manifest metadata before calling Docker', t => {
  const f = fixture(t, { manifestId: 'not-a-digest' });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest/i);
  assert.equal(f.calls().length, 0);
});

test('resumes after an image load without loading again and still validates its identity', t => {
  const f = fixture(t, { loadedId: manifestId, manifestId, skipLoad: true });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.calls().filter(call => call.args[0] === 'image' && call.args[1] === 'load').length, 0);
  assert.equal(f.calls().find(call => call.args[0] === 'compose').image, manifestId);
});

test('resume mode still refuses a wrong revision without starting rollout', t => {
  const f = fixture(t, { loadedId: manifestId, manifestId, skipLoad: true, wrongLabel: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /revision/i);
  assert.equal(f.calls().filter(call => call.args[0] === 'compose').length, 0);
});

test('containerd health failure rolls back to the previous exact image', t => {
  const f = fixture(t, { loadedId: manifestId, manifestId, failHealth: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.calls().filter(call => call.args[0] === 'compose').map(call => call.image), [manifestId, previousImage]);
  assert.equal(realpathSync(join(f.root, 'current')), f.oldRelease);
  assert.equal(readFileSync(join(f.root, 'state', 'muse.sqlite'), 'utf8'), 'production database sentinel');
});

test('rejects tampered manifest metadata even when the loaded image matches that false digest', t => {
  const falseManifestId = `sha256:${'f'.repeat(64)}`;
  const f = fixture(t, { loadedId: falseManifestId, manifestId: falseManifestId, skipLoad: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /archive.*identit/i);
  assert.equal(f.calls().length, 0);
  assert.equal(realpathSync(join(f.root, 'current')), f.oldRelease);
});
