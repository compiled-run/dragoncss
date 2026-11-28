#!/usr/bin/env bash
# Selects Xcode 27.2 (27B52), the one the committed lanes.json host lanes record (layout-vectors-host's Swift, 6.4.2), on an
# xcode-27 runner or a dragon-mini slot. The image's default Xcode moves to each new release, and a Swift other than the pinned one
# fails every toolchain check against lanes.json; the image keeps the older Xcodes installed beside it. In a workflow it also sets
# DEVELOPER_DIR for the later steps. Changing the pin is this build plus a lanes-host regen that records the new Swift.
# Moved from 27.0 (27A266a) on 2026-11-28: lanes-host on landed batch 31's tree under 27.2 changed only that Swift version string
# (every suite's counts and both corpus digests equal), in 267 s on mini-2 against 1,754 s on xcode-27.
set -euo pipefail
BUILD=27B52
for app in /Applications/Xcode*.app; do
  dev="$app/Contents/Developer"
  [ -x "$dev/usr/bin/xcodebuild" ] || continue
  if DEVELOPER_DIR="$dev" "$dev/usr/bin/xcodebuild" -version 2>/dev/null | grep -qx "Build version $BUILD"; then
    # A self-hosted slot's user cannot sudo; DEVELOPER_DIR alone selects the Xcode for every later tool.
    [ "${RUNNER_ENVIRONMENT:-}" = self-hosted ] || sudo xcode-select -s "$dev"
    export DEVELOPER_DIR="$dev"
    [ -z "${GITHUB_ENV:-}" ] || echo "DEVELOPER_DIR=$dev" >> "$GITHUB_ENV"
    echo "selected $app"
    xcodebuild -version
    exit 0
  fi
done
echo "no Xcode with build $BUILD on this runner; installed:" >&2
for app in /Applications/Xcode*.app; do echo "  $app: $(DEVELOPER_DIR="$app/Contents/Developer" "$app/Contents/Developer/usr/bin/xcodebuild" -version 2>/dev/null | tr '\n' ' ')" >&2; done
exit 1
