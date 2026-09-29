#!/usr/bin/env bash
# Builds the public homepage (07-quest-map.html) into .site/ with only the files it uses.
# The file list comes from /tmp/pm/collect.mjs (static references plus a browser run); personal-use fonts are never shipped.
set -euo pipefail
cd "$(dirname "$0")"
OUT=.site
LIST=${1:-/tmp/pm/site-files.txt}
find "$OUT" -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} + 2>/dev/null || true
mkdir -p "$OUT"
cp 07-quest-map.html "$OUT/index.html"
grep -v -E 'fonts/(night-sacred-demo|vinque-antique|wicked-knight|moria-citadel|medievalsharp)/|Rudelsberg-Initialen' "$LIST" | while IFS= read -r f; do
  mkdir -p "$OUT/$(dirname "$f")"; cp "$f" "$OUT/$f"
done
# Ship only the fonts the page uses: drop the @font-face rules for trial fonts.
python3 - "$OUT/assets/parchment.css" <<'PY'
import sys, re
p = sys.argv[1]; s = open(p).read()
s = '\n'.join(l for l in s.split('\n') if not re.match(r"@font-face \{ font-family: '(Night Sacred|Vinque Antique|Wicked Knight|Moria Citadel|MedievalSharp|Rudelsberg Initialen)'", l))
open(p, 'w').write(s)
PY
cp assets/fonts/courier-prime/OFL.txt "$OUT/assets/fonts/courier-prime/OFL.txt"
printf '.env*\n.gitignore\n' > "$OUT/.vercelignore"
cat > "$OUT/vercel.json" <<'JSON'
{
  "redirects": [
    { "source": "/(.*)", "has": [{ "type": "host", "value": "www.dragoncss.com" }], "destination": "https://dragoncss.com/$1", "permanent": true }
  ]
}
JSON
du -sh "$OUT"
