#!/usr/bin/env bash
# Re-vendors web-platform-tests at a pinned commit: css/, resources/, fonts/, images/ and LICENSE.md.
set -euo pipefail
SHA=${1:?usage: scripts/update-wpt.sh <wpt commit sha>}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
git clone -q --filter=blob:none --no-checkout https://github.com/web-platform-tests/wpt.git "$TMP/wpt"
git -C "$TMP/wpt" sparse-checkout set --no-cone /css/ /resources/ /fonts/ /images/ /LICENSE.md
git -C "$TMP/wpt" checkout -q "$SHA"
rm -rf "$ROOT/vendor/wpt/css" "$ROOT/vendor/wpt/resources" "$ROOT/vendor/wpt/fonts" "$ROOT/vendor/wpt/images"
rsync -a --exclude .git "$TMP/wpt/css" "$TMP/wpt/resources" "$TMP/wpt/fonts" "$TMP/wpt/images" "$TMP/wpt/LICENSE.md" "$ROOT/vendor/wpt/"
sed -i '' "s/^- Commit: .*/- Commit: \`$SHA\` (fetched $(date -u +%Y-%m-%d))/" "$ROOT/vendor/wpt/README.md"
rm -rf "$TMP"
echo "vendor/wpt now at $SHA"
