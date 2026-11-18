#!/bin/bash
set -u
UDID=889BBE57-16AD-46D3-9BA6-7420070E069A
D=/tmp/sysfont-measure
OUT=$D/out
PORT=8765
node $D/scripts/server.mjs $PORT $OUT > $OUT/ios-server.log 2>&1 &
SRV=$!
xcrun simctl boot $UDID 2>&1
xcrun simctl bootstatus $UDID -b 2>&1 | tail -2
rm -f $OUT/safari-ios.json
xcrun simctl openurl $UDID "http://127.0.0.1:$PORT/?name=safari-ios" 2>&1
for i in $(seq 1 90); do [ -f $OUT/safari-ios.json ] && break; sleep 2; done
ls -la $OUT/safari-ios.json || echo "SAFARI RESULT MISSING"
xcrun simctl io $UDID screenshot $OUT/safari-ios.png 2>&1 | tail -1
xcrun simctl spawn $UDID $D/scripts/probe > $OUT/coretext-ios-sim.raw.json 2> $OUT/probe.stderr
echo "probe exit $? size $(wc -c < $OUT/coretext-ios-sim.raw.json)"
xcrun simctl spawn $UDID sw_vers 2>/dev/null
kill $SRV
xcrun simctl shutdown $UDID
xcrun simctl list devices | grep $UDID
