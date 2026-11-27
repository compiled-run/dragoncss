#!/usr/bin/env bash
# Installs the Android emulator system image the Markless exports read Android's system fonts from (packages/parity/src/system-fonts/
# android.ts ANDROID_SYSTEM_IMAGE) into the runner's SDK, and checks the file they open is there. macOS runners carry the SDK
# (ANDROID_HOME) and its command-line tools, not this image. Needs a JDK 17 on PATH for sdkmanager.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
query() { node --conditions=dragon-internal --input-type=module -e "const m = await import('$root/packages/parity/src/system-fonts/android.ts'); $1"; }
pkg=$(query "const { api, tag, abi } = m.ANDROID_SYSTEM_IMAGE; console.log(\`system-images;android-\${api};\${tag};\${abi}\`)")
sdk="${ANDROID_HOME:?ANDROID_HOME is not set}/cmdline-tools/latest/bin/sdkmanager"
[ -x "$sdk" ] || { echo "::error::no sdkmanager at $sdk"; exit 1; }
yes | "$sdk" --licenses >/dev/null || true
# A download can fail transiently ("unknown archive"): three tries, each failure printing the log's tail.
for i in 1 2 3; do
  if "$sdk" --install "$pkg" > "${RUNNER_TEMP:-/tmp}/sdkmanager.log" 2>&1; then break; fi
  tail -n 20 "${RUNNER_TEMP:-/tmp}/sdkmanager.log"
  [ "$i" -lt 3 ] || { echo "::error::sdkmanager could not install $pkg"; exit 1; }
  echo "::warning::sdkmanager --install $pkg failed (attempt $i of 3)"; sleep 20
done
image=$(query "console.log(m.androidSystemImagePath())")
echo "$pkg: $image ($(du -h "$image" | cut -f1))"
