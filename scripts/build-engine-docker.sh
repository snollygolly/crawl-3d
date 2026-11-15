#!/usr/bin/env bash
# Run scripts/build-engine.sh inside engine/Dockerfile (the known-good
# toolchain). Works the same on macOS and Linux. Fetch the source first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
docker build -t crawl3d-engine "$ROOT/engine"
docker run --rm -t -v "$ROOT:/repo" -e JOBS="${JOBS:-}" crawl3d-engine \
    bash scripts/build-engine.sh
