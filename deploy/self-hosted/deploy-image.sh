#!/usr/bin/env bash
# Upgrade an existing deployment with an image produced by verified CI.
# Usage: deploy-image.sh /opt/muse-mutual/releases/<release> <full-git-commit>
set -Eeuo pipefail
umask 077

fail() { printf 'Deployment refused: %s\n' "$*" >&2; exit 1; }
[[ $# == 2 ]] || fail 'expected release directory and full Git revision'
expected_revision=$2
[[ $expected_revision =~ ^[0-9a-f]{40}$ ]] || fail 'expected revision must be a full lowercase Git SHA'
for dependency in docker sha256sum flock python3; do
  command -v "$dependency" >/dev/null || fail "required command is unavailable: $dependency"
done

deploy_root=$(cd "${MUSE_DEPLOY_ROOT:-/opt/muse-mutual}" && pwd -P)
release=$(cd "$1" && pwd -P)
[[ $release == "$deploy_root/releases/"* ]] || fail 'release must be inside the deployment releases directory'
compose=$release/deploy/self-hosted/compose.yaml
for name in image.tar.gz image.tar.gz.sha256 revision.txt image-reference.txt image-id.txt platform.txt deploy/self-hosted/compose.yaml; do
  [[ -f $release/$name && ! -L $release/$name ]] || fail "missing or symlinked release file: $name"
done

revision=$(cat "$release/revision.txt")
image=$(cat "$release/image-reference.txt")
expected_image_id=$(cat "$release/image-id.txt")
platform=$(cat "$release/platform.txt")
checksum=$(cat "$release/image.tar.gz.sha256")
[[ $revision == "$expected_revision" ]] || fail 'release revision does not match the requested revision'
[[ $image == "muse-mutual:git-$expected_revision" ]] || fail 'image reference does not match the requested revision'
[[ $expected_image_id =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid image ID'
expected_manifest_id=
if [[ -e $release/image-manifest-id.txt || -L $release/image-manifest-id.txt ]]; then
  [[ -f $release/image-manifest-id.txt && ! -L $release/image-manifest-id.txt ]] || fail 'invalid image manifest metadata file'
  expected_manifest_id=$(cat "$release/image-manifest-id.txt")
  [[ $expected_manifest_id =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid image manifest ID'
fi
[[ $platform == linux/amd64 ]] || fail 'only the server platform linux/amd64 is accepted'
[[ $checksum =~ ^[0-9a-f]{64}$ ]] || fail 'invalid archive checksum'
actual_checksum=$(sha256sum "$release/image.tar.gz")
[[ ${actual_checksum%% *} == "$checksum" ]] || fail 'image archive checksum does not match'
if [[ -n $expected_manifest_id ]]; then
  tooling_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
  archive_verifier=$tooling_directory/verify-image-archive.py
  [[ -f $archive_verifier && ! -L $archive_verifier ]] || fail 'missing image archive identity verifier'
  archive_identities=$(python3 "$archive_verifier" "$release/image.tar.gz" "$image" "$expected_image_id") || fail 'image archive identity validation failed'
  if ! python3 - "$archive_identities" "$expected_image_id" "$expected_manifest_id" <<'PY'
import json, sys
identities = json.loads(sys.argv[1])
sys.exit(0 if identities.get('configId') == sys.argv[2] and identities.get('manifestId') == sys.argv[3] else 1)
PY
  then
    fail 'image archive identities do not match the release metadata'
  fi
fi

# The lock also prevents two releases from racing the current symlink.
exec 9>"$deploy_root/deploy.lock"
flock -n 9 || fail 'another deployment is running'
[[ -L $deploy_root/current ]] || fail 'an existing current release symlink is required'
previous_release=$(cd "$deploy_root/current" && pwd -P)
[[ $previous_release == "$deploy_root/releases/"* ]] || fail 'current release is outside the deployment directory'
previous_image=$(docker container inspect --format '{{.Image}}' muse-mutual)
[[ $previous_image =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'cannot identify the previous container image'
previous_health=$(docker container inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' muse-mutual)
[[ $previous_health == healthy ]] || fail 'the existing container must be healthy before upgrading'

# Resuming a completed load avoids unpacking the same archive again on a shared
# server. All archive, identity, revision and platform checks still run.
if [[ ${MUSE_SKIP_IMAGE_LOAD:-} != 1 ]]; then
  docker image load --input "$release/image.tar.gz"
fi
loaded_image_id=$(docker image inspect --format '{{.Id}}' "$image")
# Classic Docker reports the config digest; the containerd image store reports
# the manifest digest. CI derives both from the same saved archive.
[[ $loaded_image_id == "$expected_image_id" || ( -n $expected_manifest_id && $loaded_image_id == "$expected_manifest_id" ) ]] || fail 'loaded image ID does not match the verified artifact'
loaded_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$loaded_image_id")
[[ $loaded_revision == "$expected_revision" ]] || fail 'loaded image revision label does not match the requested revision'
loaded_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$loaded_image_id")
[[ $loaded_platform == "$platform" ]] || fail 'loaded image platform does not match the server'

update_current() {
  python3 - "$deploy_root" "$1" <<'PY'
import os, sys
root, target = sys.argv[1:]
temporary = os.path.join(root, f'.current-{os.getpid()}')
try:
    os.symlink(target, temporary)
    os.replace(temporary, os.path.join(root, 'current'))
finally:
    if os.path.lexists(temporary):
        os.unlink(temporary)
PY
}

rollout_started=0
finish() {
  status=$?
  trap - EXIT
  if [[ $status != 0 && $rollout_started == 1 ]]; then
    printf 'Upgrade failed; restoring the previous image without restoring or deleting the database.\n' >&2
    if MUSE_IMAGE="$previous_image" docker compose -f "$compose" up -d --no-build --pull never --wait --wait-timeout 180; then
      update_current "$previous_release" || status=1
      printf 'Previous image restored. The release was not accepted.\n' >&2
    else
      printf 'Rollback health check failed; operator intervention is required. Database files remain in place.\n' >&2
      status=1
    fi
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Never build or pull on this shared server. The archive supplied the exact image.
printf '%s\n' "$previous_image" >"$release/previous-image-id.txt"
printf '%s\n' "$previous_release" >"$release/previous-release.txt"
rollout_started=1
MUSE_IMAGE="$loaded_image_id" docker compose -f "$compose" up -d --no-build --pull never --wait --wait-timeout 180
printf 'MUSE_IMAGE=%s\n' "$loaded_image_id" >"$release/deploy-image.env.tmp"
mv -f "$release/deploy-image.env.tmp" "$release/deploy-image.env"
printf '%s\n' "$revision" >"$release/deployed-commit.txt.tmp"
mv -f "$release/deployed-commit.txt.tmp" "$release/deployed-commit.txt"
update_current "$release"
rollout_started=0
printf 'Deployed %s with image %s\n' "$revision" "$loaded_image_id"
