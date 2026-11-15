#!/usr/bin/env bash
# Upload engine-build/<build>/ to S3 under ENGINE_PREFIX/<build>/.
# Builds are immutable: bump "build" in engine.json for every new engine,
# then commit engine.json so CI deploys the site against it.
#
#   S3_BUCKET=my-bucket ENGINE_PREFIX=crawl3d/engine scripts/upload-engine.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${S3_BUCKET:?set S3_BUCKET}"
ENGINE_PREFIX="${ENGINE_PREFIX:-crawl3d/engine}"
BUILD_ID="$(python3 -c "import json; print(json.load(open('$ROOT/engine.json'))['build'])")"
SRC="$ROOT/engine-build/$BUILD_ID"
DEST="s3://$S3_BUCKET/$ENGINE_PREFIX/$BUILD_ID"
[ -f "$SRC/manifest.json" ] || { echo "No bundle at $SRC; run scripts/build-engine.sh" >&2; exit 1; }
if aws s3 ls "$DEST/manifest.json" >/dev/null 2>&1 && [ "${FORCE:-}" != 1 ]; then
    echo "$DEST already exists. Bump \"build\" in engine.json (or FORCE=1)." >&2; exit 1
fi
CACHE="public, max-age=31536000, immutable"
aws s3 cp "$SRC/crawl.wasm" "$DEST/crawl.wasm" --content-type application/wasm --cache-control "$CACHE"
aws s3 cp "$SRC/crawl.data" "$DEST/crawl.data" --content-type application/octet-stream --cache-control "$CACHE"
aws s3 cp "$SRC/crawl.js" "$DEST/crawl.js" --content-type text/javascript --cache-control "$CACHE"
aws s3 sync "$SRC/gamedata" "$DEST/gamedata" --cache-control "$CACHE"
aws s3 cp "$SRC/manifest.json" "$DEST/manifest.json" --content-type application/json
echo "Uploaded $DEST"
