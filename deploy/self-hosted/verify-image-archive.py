#!/usr/bin/env python3
"""Derive portable image identities from a saved Docker archive, without extraction.

The caller verifies the complete archive checksum. This checks the selected
reference -> OCI manifest -> config digest chain before writing CI metadata.
"""

import argparse
import hashlib
import json
import pathlib
import re
import sys
import tarfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def identities(archive_path, image_reference, observed_id):
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", observed_id), "invalid observed image ID")
    contents = {}
    stored_bytes = 0
    with tarfile.open(archive_path, "r|gz") as archive:
        for member in archive:
            if member.name in ("manifest.json", "index.json", "oci-layout"):
                require(member.isfile() and member.size <= 1024 * 1024, "invalid archive metadata member")
            if not member.isfile() or member.size > 1024 * 1024:
                continue
            require(member.name not in contents, "duplicate archive metadata member")
            stored_bytes += member.size
            require(stored_bytes <= 64 * 1024 * 1024, "excessive archive metadata")
            contents[member.name] = archive.extractfile(member).read()

    require("manifest.json" in contents, "missing Docker archive manifest")
    docker_manifest = json.loads(contents["manifest.json"])
    require(isinstance(docker_manifest, list), "invalid Docker archive manifest")
    selected = [item for item in docker_manifest if image_reference in item.get("RepoTags", [])]
    require(len(selected) == 1, "image reference must select exactly one archive image")
    config_path = selected[0].get("Config")
    require(isinstance(config_path, str) and config_path in contents, "missing selected image config")
    config_bytes = contents[config_path]
    config_id = digest(config_bytes)
    require(config_path in (config_id[7:] + ".json", "blobs/sha256/" + config_id[7:]), "config filename does not match its content digest")
    config = json.loads(config_bytes)
    require(config.get("os") == "linux" and config.get("architecture") == "amd64", "unexpected image platform")

    manifest_id = None
    if "index.json" in contents or "oci-layout" in contents:
        require("index.json" in contents and "oci-layout" in contents, "incomplete OCI archive metadata")
        require(json.loads(contents["oci-layout"]).get("imageLayoutVersion") == "1.0.0", "unsupported OCI layout")
        index = json.loads(contents["index.json"])
        require(index.get("schemaVersion") == 2, "invalid OCI index schema")
        full_reference = image_reference if image_reference.startswith("docker.io/") else "docker.io/library/" + image_reference
        descriptors = [item for item in index.get("manifests", [])
                       if item.get("annotations", {}).get("io.containerd.image.name") in (image_reference, full_reference)]
        require(len(descriptors) == 1, "image reference must select exactly one OCI manifest")
        descriptor = descriptors[0]
        require(descriptor.get("mediaType") in ("application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"), "unsupported OCI image descriptor")
        manifest_id = descriptor.get("digest", "")
        require(re.fullmatch(r"sha256:[0-9a-f]{64}", manifest_id), "invalid OCI manifest digest")
        manifest_bytes = contents.get("blobs/sha256/" + manifest_id[7:])
        require(manifest_bytes is not None, "missing selected OCI manifest")
        require(digest(manifest_bytes) == manifest_id and len(manifest_bytes) == descriptor.get("size"), "OCI manifest content differs from its descriptor")
        manifest = json.loads(manifest_bytes)
        require(manifest.get("schemaVersion") == 2, "invalid OCI manifest schema")
        config_descriptor = manifest.get("config", {})
        require(config_descriptor.get("digest") == config_id and config_descriptor.get("size") == len(config_bytes), "OCI manifest points to a different config")

    require(observed_id in (config_id, manifest_id), "observed image ID differs from both archive identities")
    return {"configId": config_id, "manifestId": manifest_id}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("image_reference")
    parser.add_argument("observed_id")
    parser.add_argument("--metadata-dir", type=pathlib.Path)
    args = parser.parse_args()
    try:
        result = identities(args.archive, args.image_reference, args.observed_id)
        if args.metadata_dir:
            require(args.metadata_dir.is_dir(), "metadata output directory does not exist")
            args.metadata_dir.joinpath("image-id.txt").write_text(result["configId"] + "\n")
            manifest_path = args.metadata_dir.joinpath("image-manifest-id.txt")
            if result["manifestId"]:
                manifest_path.write_text(result["manifestId"] + "\n")
            else:
                manifest_path.unlink(missing_ok=True)
        print(json.dumps(result))
    except (ValueError, KeyError, TypeError, AttributeError, OSError, tarfile.TarError) as error:
        print(f"Image identity refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
