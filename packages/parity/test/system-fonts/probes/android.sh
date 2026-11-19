#!/bin/bash
# Re-runs the 2026-11-18 Android measurement behind ../android-paint.json; it needs a harness that is not in the repo (docs/system-fonts.md "Probes").
set -euo pipefail
refuse() { echo "android.sh: $1; see docs/system-fonts.md \"Probes\"" >&2; exit 2; }
D=${SYSFONT_HARNESS:-}
[ -n "$D" ] || refuse "SYSFONT_HARNESS is not set: it names the measuring harness (scripts/server.mjs, the page it serves, and the probe APK), which is not in the repo"
[ -f "$D/scripts/server.mjs" ] || refuse "the harness $D has no scripts/server.mjs (the server that serves the measuring page and stores what it posts)"
APK=$D/scripts/android/build/sysfont.apk
[ -f "$APK" ] || refuse "the harness $D has no scripts/android/build/sysfont.apk (probes/android built with build-tools 36.0.0; the build script is not in the repo)"
S=${ANDROID_HOME:-$HOME/Library/Android/sdk}
ADB="$S/platform-tools/adb -s emulator-5560"
OUT=$D/out; PORT=8766
mkdir -p "$OUT"
node "$D/scripts/server.mjs" $PORT "$OUT" > "$OUT/android-server.log" 2>&1 &
SRV=$!
"$S/emulator/emulator" -avd markless_dragon_bugs -port 5560 -no-snapshot-save -no-audio -no-window -no-boot-anim > "$OUT/emulator.log" 2>&1 &
EMU=$!
LC=
trap '[ -n "$LC" ] && kill $LC 2>/dev/null; $ADB emu kill 2>/dev/null; kill $EMU $SRV 2>/dev/null || true' EXIT
$ADB wait-for-device
booted=
for _ in $(seq 1 180); do [ "$($ADB shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && booted=1 && break; sleep 2; done
[ -n "$booted" ] || { echo "android.sh: the emulator did not finish booting in 360 s" >&2; exit 1; }
$ADB shell getprop ro.build.fingerprint > "$OUT/android-fingerprint.txt"
$ADB shell wm density > "$OUT/android-wm.txt"; $ADB shell wm size >> "$OUT/android-wm.txt"
$ADB shell pm list packages > "$OUT/android-packages.txt"
$ADB shell dumpsys webviewupdate > "$OUT/android-webviewupdate.txt"
$ADB pull /system/etc/fonts.xml "$OUT/fonts.xml"
$ADB pull /system/etc/font_fallback.xml "$OUT/font_fallback.xml" 2>&1 | tail -1 || echo "android.sh: no /system/etc/font_fallback.xml (an optional file)"
$ADB shell ls -l /system/fonts > "$OUT/android-system-fonts-ls.txt"
rm -f "$OUT/android-webview.json" "$OUT/android-paint.json" "$OUT/android-chrome.json"
$ADB install -r "$APK"
$ADB logcat -c
$ADB logcat -s 'SYSFONT:*' 'chromium:*' > "$OUT/android-logcat.txt" 2>&1 &
LC=$!
$ADB shell am start -W -n dev.markless.sysfont/.Main
for _ in $(seq 1 150); do [ -f "$OUT/android-webview.json" ] && [ -f "$OUT/android-paint.json" ] && break; sleep 2; done
[ -f "$OUT/android-webview.json" ] && [ -f "$OUT/android-paint.json" ] || { echo "android.sh: the probe app posted no android-webview.json and android-paint.json in 300 s" >&2; exit 1; }
$ADB exec-out screencap -p > "$OUT/android-webview.png"
if grep -q 'package:com.android.chrome$' "$OUT/android-packages.txt"; then
  $ADB shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'
  $ADB shell am set-debug-app --persistent com.android.chrome
  $ADB shell am start -a android.intent.action.VIEW -d "http://10.0.2.2:$PORT/?name=android-chrome" com.android.chrome
  for _ in $(seq 1 60); do [ -f "$OUT/android-chrome.json" ] && break; sleep 2; done
  [ -f "$OUT/android-chrome.json" ] || { echo "android.sh: Chrome posted no android-chrome.json in 120 s" >&2; exit 1; }
  $ADB exec-out screencap -p > "$OUT/android-chrome.png"
  $ADB shell am clear-debug-app
  $ADB shell rm /data/local/tmp/chrome-command-line
fi
$ADB uninstall dev.markless.sysfont
