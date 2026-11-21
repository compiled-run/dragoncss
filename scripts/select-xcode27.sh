#!/usr/bin/env bash
# Selects Xcode 27.0 (27A266a), the local Mac's and the one the committed lanes.json host lanes record (layout-vectors-host's
# Swift), on an xcode-27 runner. The image's default Xcode moves to each new release (27.0 to 27.1, 27A9275, by 2026-10-26), and a
# newer Swift fails every toolchain check against lanes.json; the image keeps the older Xcodes installed beside it. In a workflow
# it also sets DEVELOPER_DIR for the later steps. Changing the pin is this build plus a lanes-host regen that records the new Swift.
set -euo pipefail
BUILD=27A266a
for app in /Applications/Xcode*.app; do
  dev="$app/Contents/Developer"
  [ -x "$dev/usr/bin/xcodebuild" ] || continue
  if DEVELOPER_DIR="$dev" "$dev/usr/bin/xcodebuild" -version 2>/dev/null | grep -qx "Build version $BUILD"; then
    sudo xcode-select -s "$dev"
    [ -z "${GITHUB_ENV:-}" ] || echo "DEVELOPER_DIR=$dev" >> "$GITHUB_ENV"
    echo "selected $app"
    xcodebuild -version
    exit 0
  fi
done
echo "no Xcode with build $BUILD on this runner; installed:" >&2
for app in /Applications/Xcode*.app; do echo "  $app: $(DEVELOPER_DIR="$app/Contents/Developer" "$app/Contents/Developer/usr/bin/xcodebuild" -version 2>/dev/null | tr '\n' ' ')" >&2; done
exit 1
