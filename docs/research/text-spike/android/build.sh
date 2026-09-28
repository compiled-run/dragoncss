#!/bin/sh
# Gradle-free APK build: kotlinc -> d8 -> aapt2 link (assets) -> add dex -> zipalign -> apksigner.
set -e
cd /tmp/text-spike/android
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
KLIB=/opt/homebrew/Cellar/kotlin/2.4.20/libexec/lib
AJ=/opt/homebrew/share/android-commandlinetools/platforms/android-36/android.jar
BT=/opt/homebrew/share/android-commandlinetools/build-tools/36.0.0
rm -rf build && mkdir build
kotlinc -cp $AJ -jvm-target 17 Main.kt -d build/main.jar 2>&1 | grep -i error || true
$BT/d8 --min-api 30 --lib $AJ --output build build/main.jar $KLIB/kotlin-stdlib.jar >/dev/null 2>&1
$BT/aapt2 link -o build/unsigned.apk -I $AJ --manifest apk/AndroidManifest.xml -A apk/assets --debug-mode -0 ttf -0 otf
(cd build && zip -q -j unsigned.apk classes.dex)
$BT/zipalign -f 4 build/unsigned.apk build/aligned.apk
[ -f debug.keystore ] || keytool -genkeypair -keystore debug.keystore -storepass android -keypass android -alias debug -keyalg RSA -keysize 2048 -validity 10000 -dname CN=debug >/dev/null 2>&1
$BT/apksigner sign --ks debug.keystore --ks-pass pass:android --out build/spike.apk build/aligned.apk
ls -la build/spike.apk
