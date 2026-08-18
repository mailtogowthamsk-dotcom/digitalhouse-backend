#!/usr/bin/env bash
# Download nsfwjs MobileNet V2 graph model into models/nsfwjs/ (not committed).
# Source: https://github.com/infinitered/nsfwjs (MIT)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${MODERATION_MODEL_DIR:-$ROOT/models/nsfwjs}"
BASE="https://raw.githubusercontent.com/infinitered/nsfwjs/master/models/mobilenet_v2"
export BASE
mkdir -p "$DEST"
cd "$DEST"
curl -fsSL -o model.json "$BASE/model.json"
# Weights listed in model.json — fetch common shards if present in the JSON.
python3 - <<'PY' || true
import json, os, urllib.request
base = os.environ.get("BASE") or "https://raw.githubusercontent.com/infinitered/nsfwjs/master/models/mobilenet_v2"
with open("model.json") as f:
    spec = json.load(f)
paths = []
weights = spec.get("weightsManifest") or []
for group in weights:
    for p in group.get("paths") or []:
        paths.append(p)
for p in paths:
    url = base.rstrip("/") + "/" + p
    print("fetch", p)
    urllib.request.urlretrieve(url, p)
print("ok", len(paths), "weight files")
PY
echo "Installed nsfwjs weights in $DEST"
echo "Set MODERATION_MODEL_DIR=$DEST"
