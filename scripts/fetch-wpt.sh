#!/usr/bin/env bash
# Fetches web-platform-tests at the commit pinned in packages/wpt/wpt.lock (its "wpt <sha>" line) into vendor/wpt (or $DRAGON_WPT_DIR) when it is absent:
# css/, resources/, fonts/, images/ and LICENSE.md. WPT is not committed to this repository. An existing copy at another commit is
# left alone and reported; changing the pin is a reviewed edit of wpt.lock plus pnpm wpt:run and wpt:update-expectations.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SHA=$(sed -n 's/^wpt \([0-9a-f]\{40\}\)$/\1/p' "$ROOT/packages/wpt/wpt.lock")
[ -n "$SHA" ] || { echo "packages/wpt/wpt.lock has no \"wpt <commit>\" line" >&2; exit 1; }
DEST=${DRAGON_WPT_DIR:-$ROOT/vendor/wpt}
if [ -d "$DEST/css" ]; then
  HAVE=$(sed -n 's/^- Commit: `\([0-9a-f]*\)`.*/\1/p' "$DEST/README.md" 2>/dev/null || true)
  if [ "$HAVE" = "$SHA" ]; then
    echo "$DEST is already at $SHA"
    exit 0
  fi
  echo "$DEST is at ${HAVE:-an unrecorded commit}, but packages/wpt/wpt.lock pins $SHA; move it away and rerun" >&2
  exit 1
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git clone -q --filter=blob:none --no-checkout https://github.com/web-platform-tests/wpt.git "$TMP/wpt"
git -C "$TMP/wpt" sparse-checkout set --no-cone /css/ /resources/ /fonts/ /images/ /LICENSE.md
git -C "$TMP/wpt" checkout -q "$SHA"
mkdir -p "$DEST"
rsync -a --exclude .git "$TMP/wpt/css" "$TMP/wpt/resources" "$TMP/wpt/fonts" "$TMP/wpt/images" "$TMP/wpt/LICENSE.md" "$DEST/"
cat > "$DEST/README.md" <<README
# web-platform-tests (fetched)

A pinned copy of the shared browser conformance suite, used as Dragon's spec oracle next to Chrome
(docs/decisions.md, "Spec conformance through web-platform-tests").

- Source: https://github.com/web-platform-tests/wpt
- Commit: \`$SHA\` (fetched $(date -u +%Y-%m-%d))
- Copied: \`css/\` (all specs), \`resources/\`, \`fonts/\`, \`images/\`, \`LICENSE.md\`
- Licence: 3-clause BSD (LICENSE.md). Keep this file and LICENSE.md with any redistribution.

Do not edit files here. It is fetched by scripts/fetch-wpt.sh at the commit in packages/wpt/wpt.lock and is not committed.
Which tests Dragon runs, and each result, live in Dragon's expectations files (packages/wpt/expectations), not in this folder.
README
echo "$DEST now at $SHA"
