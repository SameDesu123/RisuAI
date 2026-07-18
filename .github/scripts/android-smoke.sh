#!/usr/bin/env bash
set -Eeuo pipefail

package_id="${ANDROID_PACKAGE_ID:-co.aiclient.risu}"
apk_path="$(find src-tauri/gen/android/app/build/outputs/apk -type f -name '*debug*.apk' -print -quit)"

collect_diagnostics() {
  adb exec-out screencap -p > android-smoke.png 2>/dev/null || true
  adb logcat -b all -d -v threadtime > android-logcat.txt 2>/dev/null || true
  adb shell dumpsys activity activities > android-activity.txt 2>/dev/null || true
  adb shell dumpsys package "$package_id" > android-package.txt 2>/dev/null || true
}

wait_for_pid() {
  local current_pid=''
  for _ in $(seq 1 30); do
    current_pid="$(adb shell pidof "$package_id" | tr -d '\r')"
    if [ -n "$current_pid" ]; then
      printf '%s\n' "$current_pid"
      return 0
    fi
    sleep 1
  done
  return 1
}

trap collect_diagnostics EXIT

test -n "$apk_path"
adb install --no-streaming -r "$apk_path" | tr -d '\r' | tee android-install.txt
grep -Fxq 'Success' android-install.txt

launcher_component="$(
  adb shell cmd package resolve-activity --brief \
    -a android.intent.action.MAIN \
    -c android.intent.category.LAUNCHER \
    "$package_id" | tr -d '\r' | tail -n 1
)"
test -n "$launcher_component"

package_dump="$(adb shell dumpsys package "$package_id" | tr -d '\r')"
grep -q 'risuailocal' <<< "$package_dump"
adb logcat -c
adb shell am start -W -n "$launcher_component" | tr -d '\r' | tee android-launch.txt
grep -Eq '^Status: ok$' android-launch.txt

pid="$(wait_for_pid)"
sleep 10
test -n "$(adb shell pidof "$package_id" | tr -d '\r')"

database_path="$(adb shell run-as "$package_id" find . -name database.bin -type f | tr -d '\r' | sed -n '1p')"
test -n "$database_path"
adb shell run-as "$package_id" test -s "$database_path"

adb shell am force-stop "$package_id"
adb shell am start -W -n "$launcher_component" | tr -d '\r' | tee android-relaunch.txt
grep -Eq '^Status: ok$' android-relaunch.txt
pid="$(wait_for_pid)"
sleep 5
test -n "$(adb shell pidof "$package_id" | tr -d '\r')"
adb shell run-as "$package_id" test -s "$database_path"

adb shell am start -W \
  -a android.intent.action.VIEW \
  -d 'risuailocal://noop/smoke' \
  -p "$package_id" | tr -d '\r' | tee android-deep-link.txt
grep -Eq '^Status: ok$' android-deep-link.txt
sleep 5
test -n "$(adb shell pidof "$package_id" | tr -d '\r')"

collect_diagnostics
if grep -Eq "Process: ${package_id//./\\.}|ANR in ${package_id//./\\.}|>>> ${package_id//./\\.} <<<|Fatal signal.*[Rr]isu" android-logcat.txt; then
  exit 1
fi

trap - EXIT
