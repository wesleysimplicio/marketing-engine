#!/usr/bin/env python3
"""Write the consumer's verified Simplicio Loop release lock.

The workflow supplies the tag and commit obtained from the public Loop release/tag
refs, plus a downloaded release asset's URL, size, and SHA-256. A source tag alone
is not enough evidence for a consumer lock.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")


def build_lock(tag: str, commit: str, artifact_url: str, artifact_digest: str,
               artifact_size: str) -> dict:
    version = tag[1:] if tag.startswith("v") else tag
    if not tag.startswith("v") or not SEMVER.fullmatch(version):
        raise ValueError("tag must be vMAJOR.MINOR.PATCH")
    if not COMMIT.fullmatch(commit):
        raise ValueError("a full lowercase 40-character commit is required")
    if not artifact_url.startswith("https://github.com/wesleysimplicio/simplicio-loop/"):
        raise ValueError("artifact URL must point to a public Loop release asset")
    if not SHA256.fullmatch(artifact_digest):
        raise ValueError("artifact digest must be a SHA-256 hex digest")
    try:
        size = int(artifact_size)
    except ValueError as exc:
        raise ValueError("artifact size must be an integer") from exc
    if size <= 0:
        raise ValueError("artifact size must be positive")
    return {
        "schema": "simplicio.consumer-release-lock/v1",
        "producer": "simplicio-loop",
        "repository": "wesleysimplicio/simplicio-loop",
        "version": version,
        "tag": tag,
        "commit": commit,
        "artifact": {
            "url": artifact_url,
            "size": size,
            "digest": artifact_digest if artifact_digest.startswith("sha256:")
            else "sha256:" + artifact_digest,
        },
        "source": "github-release-tag-and-asset-sha256",
    }


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 5:
        raise SystemExit("usage: sync_loop_release.py TAG COMMIT ARTIFACT_URL SHA256 SIZE")
    try:
        lock = build_lock(*args)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    path = Path(".simplicio/release-train/loop-lock.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(lock, indent=2, sort_keys=True) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == encoded:
        return 0
    path.write_text(encoded, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
