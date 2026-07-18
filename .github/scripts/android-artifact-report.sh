#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: android-artifact-report.sh <apk-or-aab> [...]" >&2
  exit 2
fi

report_path="${ANDROID_SIZE_REPORT:-android-size-report.txt}"
build_tools_dir="${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}"
: > "$report_path"

for artifact_path in "$@"; do
  artifact_name="$(basename "$artifact_path")"
  artifact_bytes="$(stat -c '%s' "$artifact_path")"
  artifact_sha256="$(sha256sum "$artifact_path" | cut -d ' ' -f 1)"

  {
    echo "artifact=$artifact_name"
    echo "bytes=$artifact_bytes"
    echo "sha256=$artifact_sha256"
  } >> "$report_path"

  case "$artifact_path" in
    *.apk)
      badging="$($build_tools_dir/aapt dump badging "$artifact_path")"
      printf '%s\n' "$badging" | grep -E '^(package|sdkVersion|targetSdkVersion|native-code):' >> "$report_path"

      if [ -n "${ANDROID_MIN_TARGET_SDK:-}" ]; then
        target_sdk="$(printf '%s\n' "$badging" | sed -n "s/^targetSdkVersion:'\([0-9][0-9]*\)'$/\1/p")"
        if [ -z "$target_sdk" ] || [ "$target_sdk" -lt "$ANDROID_MIN_TARGET_SDK" ]; then
          echo "APK target SDK is below the required level: ${target_sdk:-missing} < ${ANDROID_MIN_TARGET_SDK}" >&2
          exit 1
        fi
      fi

      if [ -n "${ANDROID_EXPECTED_ABI:-}" ]; then
        expected_native_code="native-code: '${ANDROID_EXPECTED_ABI}'"
        if ! printf '%s\n' "$badging" | grep -Fxq "$expected_native_code"; then
          echo "Expected only ${ANDROID_EXPECTED_ABI}, but APK badging was:" >&2
          printf '%s\n' "$badging" | grep '^native-code:' >&2 || true
          exit 1
        fi
      fi

      if [ -n "${ANDROID_MAX_APK_BYTES:-}" ] && [ "$artifact_bytes" -gt "$ANDROID_MAX_APK_BYTES" ]; then
        echo "APK exceeds size budget: ${artifact_bytes} > ${ANDROID_MAX_APK_BYTES}" >&2
        exit 1
      fi

      "$build_tools_dir/apksigner" verify --verbose --print-certs "$artifact_path" >> "$report_path"
      "$build_tools_dir/zipalign" -c -P 16 4 "$artifact_path"
      unzip -l "$artifact_path" | awk '/lib\/.*\.so$/ { print "native-lib=" $4 ",bytes=" $1 }' >> "$report_path"
      ;;
    *.aab)
      signature_report="$(jarsigner -verify "$artifact_path" 2>&1)"
      printf '%s\n' "$signature_report" >> "$report_path"
      if ! grep -Fq 'jar verified.' <<< "$signature_report" \
        || grep -Fq 'jar is unsigned.' <<< "$signature_report" \
        || grep -Fq 'contains unsigned entries' <<< "$signature_report"; then
        echo "AAB signature verification failed: $artifact_path" >&2
        exit 1
      fi
      unzip -l "$artifact_path" | awk '/base\/lib\/.*\.so$/ { print "native-lib=" $4 ",bytes=" $1 }' >> "$report_path"
      ;;
    *)
      echo "Unsupported Android artifact: $artifact_path" >&2
      exit 2
      ;;
  esac

  echo >> "$report_path"
done

cat "$report_path"
