#!/bin/bash
# Re-runs the 2026-11-18 iOS measurement behind ../ios-coretext.json; it needs a harness that is not in the repo (docs/system-fonts.md "Probes").
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
refuse() { echo "ios.sh: $1; see docs/system-fonts.md \"Probes\"" >&2; exit 2; }
D=${SYSFONT_HARNESS:-}
[ -n "$D" ] || refuse "SYSFONT_HARNESS is not set: it names the measuring harness (scripts/server.mjs and the page it serves), which is not in the repo"
[ -f "$D/scripts/server.mjs" ] || refuse "the harness $D has no scripts/server.mjs (the server that serves the measuring page and stores what it posts)"
UDID=${SYSFONT_IOS_UDID:-889BBE57-16AD-46D3-9BA6-7420070E069A}
OUT=$D/out
PORT=8765
mkdir -p "$OUT"
xcrun --sdk iphonesimulator swiftc -target arm64-apple-ios27.0-simulator "$here/coretext-probe.swift" -o "$OUT/probe"
node "$D/scripts/server.mjs" $PORT "$OUT" > "$OUT/ios-server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true; xcrun simctl shutdown $UDID 2>/dev/null || true' EXIT
xcrun simctl boot $UDID 2>&1 || true
xcrun simctl bootstatus $UDID -b 2>&1 | tail -2
rm -f "$OUT/safari-ios.json"
xcrun simctl openurl $UDID "http://127.0.0.1:$PORT/?name=safari-ios"
for _ in $(seq 1 90); do [ -f "$OUT/safari-ios.json" ] && break; sleep 2; done
[ -f "$OUT/safari-ios.json" ] || { echo "ios.sh: Safari posted no $OUT/safari-ios.json in 180 s" >&2; exit 1; }
xcrun simctl io $UDID screenshot "$OUT/safari-ios.png" 2>&1 | tail -1
xcrun simctl spawn $UDID "$OUT/probe" > "$OUT/coretext-ios-sim.raw.json" 2> "$OUT/probe.stderr"
echo "probe output $(wc -c < "$OUT/coretext-ios-sim.raw.json") bytes"
xcrun simctl spawn $UDID sw_vers
