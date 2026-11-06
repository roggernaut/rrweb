#!/usr/bin/env bash
# THROWAWAY SPIKE: runs inside the Android emulator job.
set -x
adb install -r fenix.apk || exit 10
PKG=$(adb shell pm list packages | tr -d '\r' | grep -o 'org\.mozilla\.fen[a-z_]*\|org\.mozilla\.firefox[a-z_]*' | head -1)
echo "package: $PKG"
adb shell dumpsys package "$PKG" | grep -m1 versionName
adb reverse tcp:8123 tcp:8123
./geckodriver --port 4444 --log trace > geckodriver.log 2>&1 &
GD=$!
sleep 3
CAPS=$(printf '{"browserName":"firefox","moz:firefoxOptions":{"androidPackage":"%s","androidDeviceSerial":"emulator-5554","prefs":{"devtools.debugger.remote-enabled":true}}}' "$PKG")
DRIVER_URL=http://127.0.0.1:4444 CAPS="$CAPS" PAGE_HOST=127.0.0.1 timeout 600 node record-check.mjs
rc=$?
adb logcat -d > logcat.txt 2>&1
kill $GD
exit $rc
