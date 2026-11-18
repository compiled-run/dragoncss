#!/bin/bash
set -u
S=~/Library/Android/sdk
ADB="$S/platform-tools/adb -s emulator-5560"
D=/tmp/sysfont-measure; OUT=$D/out; PORT=8766
node $D/scripts/server.mjs $PORT $OUT > $OUT/android-server.log 2>&1 &
SRV=$!
$S/emulator/emulator -avd markless_dragon_bugs -port 5560 -no-snapshot-save -no-audio -no-window -no-boot-anim > $OUT/emulator.log 2>&1 &
EMU=$!
$ADB wait-for-device
for i in $(seq 1 180); do [ "$($ADB shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 2; done
echo "booted after loop $i"
$ADB shell getprop ro.build.fingerprint > $OUT/android-fingerprint.txt
$ADB shell wm density > $OUT/android-wm.txt; $ADB shell wm size >> $OUT/android-wm.txt
$ADB shell pm list packages > $OUT/android-packages.txt
$ADB shell dumpsys webviewupdate > $OUT/android-webviewupdate.txt
$ADB pull /system/etc/fonts.xml $OUT/fonts.xml
$ADB pull /system/etc/font_fallback.xml $OUT/font_fallback.xml 2>&1 | tail -1
$ADB shell ls -l /system/fonts > $OUT/android-system-fonts-ls.txt
rm -f $OUT/android-webview.json $OUT/android-paint.json $OUT/android-chrome.json
$ADB install -r $D/scripts/android/build/sysfont.apk
$ADB logcat -c
$ADB logcat -s SYSFONT:* chromium:* > $OUT/android-logcat.txt 2>&1 &
LC=$!
$ADB shell am start -W -n dev.markless.sysfont/.Main
for i in $(seq 1 150); do [ -f $OUT/android-webview.json ] && [ -f $OUT/android-paint.json ] && break; sleep 2; done
ls -la $OUT/android-webview.json $OUT/android-paint.json
$ADB exec-out screencap -p > $OUT/android-webview.png
if grep -q 'package:com.android.chrome$' $OUT/android-packages.txt; then
  echo "chrome present"
  $ADB shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'
  $ADB shell am set-debug-app --persistent com.android.chrome
  $ADB shell am start -a android.intent.action.VIEW -d "http://10.0.2.2:$PORT/?name=android-chrome" com.android.chrome
  for i in $(seq 1 60); do [ -f $OUT/android-chrome.json ] && break; sleep 2; done
  ls -la $OUT/android-chrome.json
  $ADB exec-out screencap -p > $OUT/android-chrome.png
  $ADB shell am clear-debug-app
  $ADB shell rm /data/local/tmp/chrome-command-line
fi
$ADB uninstall dev.markless.sysfont
kill $LC
$ADB emu kill
sleep 5
kill $EMU 2>/dev/null
kill $SRV
