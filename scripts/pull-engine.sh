#!/usr/bin/env bash
# Download the engine bundle named in engine.json from S3 into
# engine-build/<build>/ (CI uses this; skips if it's already there).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${S3_BUCKET:?set S3_BUCKET}"
ENGINE_PREFIX="${ENGINE_PREFIX:-crawl3d/engine}"
BUILD_ID="$(python3 -c "import json; print(json.load(open('$ROOT/engine.json'))['build'])")"
OUT="$ROOT/engine-build/$BUILD_ID"
if [ -f "$OUT/manifest.json" ]; then echo "engine $BUILD_ID already present"; exit 0; fi
aws s3 sync "s3://$S3_BUCKET/$ENGINE_PREFIX/$BUILD_ID" "$OUT"
[ -f "$OUT/manifest.json" ] || { echo "engine $BUILD_ID not found in S3" >&2; exit 1; }
