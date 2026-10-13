import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = join(dirname(fileURLToPath(import.meta.url)), 'verify-image-archive.py');
const image = `muse-mutual:git-${'a'.repeat(40)}`;
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'muse-image-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, 'metadata');
  mkdirSync(output);
  const config = JSON.stringify({ architecture: 'amd64', os: 'linux', config: { Labels: { 'org.opencontainers.image.revision': 'a'.repeat(40) } }, rootfs: { type: 'layers', diff_ids: [] } });
  const configId = digest(config);
  const configPath = `blobs/sha256/${configId.slice(7)}`;
  const manifest = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: options.wrongConfig ? `sha256:${'f'.repeat(64)}` : configId, size: Buffer.byteLength(config) }, layers: [] });
  const manifestId = digest(manifest);
  const files = {
    [configPath]: config,
    'manifest.json': JSON.stringify([{ Config: configPath, RepoTags: [image], Layers: [] }]),
  };
  if (!options.classic) {
    files['oci-layout'] = JSON.stringify({ imageLayoutVersion: '1.0.0' });
    files['index.json'] = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{
      mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: manifestId, size: Buffer.byteLength(manifest),
      annotations: { 'io.containerd.image.name': `docker.io/library/${options.wrongRef ? 'other:tag' : image}`, 'org.opencontainers.image.ref.name': image.split(':')[1] },
    }] });
    files[`blobs/sha256/${manifestId.slice(7)}`] = options.corruptManifest ? `${manifest} ` : manifest;
  }
  const archive = join(root, 'image.tar.gz');
  const createArchive = spawnSync('python3', ['-c', `
import io, json, sys, tarfile
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    for name, value in json.loads(sys.argv[2]).items():
        data = value.encode()
        info = tarfile.TarInfo(name)
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
`, archive, JSON.stringify(files)], { encoding: 'utf8' });
  assert.equal(createArchive.status, 0, createArchive.stderr);
  const run = (observedId = configId) => spawnSync('python3', [script, archive, image, observedId, '--metadata-dir', output], { encoding: 'utf8' });
  return { output, configId, manifestId, run };
}

test('packages a config identity and only its matching archive manifest identity', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(f.output, 'image-id.txt'), 'utf8'), `${f.configId}\n`);
  assert.equal(readFileSync(join(f.output, 'image-manifest-id.txt'), 'utf8'), `${f.manifestId}\n`);
});

test('normalizes a containerd CI identity to the same portable config and manifest metadata', t => {
  const f = fixture(t);
  const result = f.run(f.manifestId);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(f.output, 'image-id.txt'), 'utf8'), `${f.configId}\n`);
  assert.equal(readFileSync(join(f.output, 'image-manifest-id.txt'), 'utf8'), `${f.manifestId}\n`);
});

test('classic archives produce a config identity without a manifest fallback', t => {
  const f = fixture(t, { classic: true });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(f.output, 'image-id.txt'), 'utf8'), `${f.configId}\n`);
  assert.equal(existsSync(join(f.output, 'image-manifest-id.txt')), false);
});

for (const [name, options] of [
  ['rejects an OCI manifest pointing to an unrelated config', { wrongConfig: true }],
  ['rejects a manifest whose content differs from its descriptor digest', { corruptManifest: true }],
  ['rejects an OCI manifest associated with another image reference', { wrongRef: true }],
]) {
  test(name, t => {
    const f = fixture(t, options);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Image identity refused:/);
    assert.equal(existsSync(join(f.output, 'image-id.txt')), false);
    assert.equal(existsSync(join(f.output, 'image-manifest-id.txt')), false);
  });
}

test('rejects an observed CI image ID unrelated to either authenticated archive identity', t => {
  const f = fixture(t);
  const result = f.run(`sha256:${'d'.repeat(64)}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Image identity refused:/);
  assert.equal(existsSync(join(f.output, 'image-id.txt')), false);
});
