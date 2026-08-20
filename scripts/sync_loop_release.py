#!/usr/bin/env python3
"""Write the consumer's verified Simplicio Loop release lock.

The workflow supplies the tag and commit obtained from the public Loop release/tag
refs. The lock is deterministic and is the only file the bump PR changes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("usage: sync_loop_release.py TAG COMMIT")
tag, commit = sys.argv[1:]
if not tag or not commit or len(commit) != 40:
    raise SystemExit("tag and a full 40-character commit are required")
version = tag[1:] if tag.startswith("v") else tag
lock = {
    "schema": "simplicio.consumer-release-lock/v1",
    "producer": "simplicio-loop",
    "repository": "wesleysimplicio/simplicio-loop",
    "version": version,
    "tag": tag,
    "commit": commit,
    "source": "github-release-tag",
}
path = Path(".simplicio/release-train/loop-lock.json")
path.parent.mkdir(parents=True, exist_ok=True)
encoded = json.dumps(lock, indent=2, sort_keys=True) + "\n"
if path.exists() and path.read_text(encoding="utf-8") == encoded:
    raise SystemExit(0)
path.write_text(encoded, encoding="utf-8")
