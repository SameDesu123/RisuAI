# Android port

RisuAI's Android app uses Tauri 2 and keeps the existing RisuSave format. The main database, assets, remote character blocks, and cold-storage records remain in the application's private Tauri `AppData` directory. Android compilation and emulator work run only in GitHub Actions; normal development does not require a local Android SDK, NDK, Gradle installation, or emulator.

## GitHub Actions profiles

The `Android Build` workflow keeps the default path intentionally small:

1. Run `pnpm check` and `pnpm test`.
2. Build one ARM64 debug APK.
3. Strip Rust debug symbols, omit Android CI source maps, verify the signature/alignment/ABI, and enforce a 160 MiB APK budget.
4. Upload `RisuAI-Android-installable-arm64-v<version>` with a size report.

The default job does not build x86_64, ARMv7, x86, or an AAB. Manual dispatch exposes two independent options:

- `run_emulator_smoke`: build one stripped x86_64 debug APK and test it directly in an API 35 emulator. The emulator APK is not uploaded as a user-facing artifact.
- `build_full_release`: build a signed ARM64 release APK and signed multi-ABI AAB. This runs only when requested and requires the signing secrets below.

The old `feat/android-port` workflow built a two-ABI debug APK and a four-ABI APK/AAB on every push. Its debug APK was 586,828,093 bytes and its combined unsigned release artifact was 507,815,844 bytes. The older MVP appeared smaller mainly because it built only ARM64 and let GitHub recompress the artifact. The new workflow reports every APK/AAB and native-library size separately so ABI or symbol regressions are visible.

## Installation and signing

The default ARM64 debug APK is signed by Android's CI debug key and is suitable for a clean ARM64 Android 7+ device. A build signed by a different key cannot update an existing `co.aiclient.risu` installation. Back up the app data and uninstall the previous build if Android reports `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.

Stable updates and release distribution require a persistent keystore. Configure these repository secrets before requesting `build_full_release`:

- `ANDROID_KEY_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_KEY_STORE_PASSWORD` (optional when it matches `ANDROID_KEY_PASSWORD`)

The release job decodes the keystore only on the runner, signs the ARM64 APK with `apksigner`, signs the AAB with `jarsigner`, and verifies both before upload. An AAB is a Play-distribution bundle and cannot be installed directly on a phone.

## Android behavior

- Android starts in the mobile UI automatically.
- System bars, display cutouts, dynamic viewport height, keyboard resizing, and the Back button are handled separately from desktop window behavior.
- Back closes the active input, modal, settings layer, sidebar, or chat first. At the root it requests a full database flush and exits only after it succeeds; a stalled flush leaves the app open instead of forcing a potentially lossy exit.
- Database writes preserve the existing RisuSave layout. The main `database.bin` uses a temporary file and rename on Android; remote blocks and cold storage keep their established paths and formats.
- Imports use Android document/content URIs. Exports use the system save-document dialog.
- After initial setup, custom `risuailocal://` links are registered at cold start and while the app is running.
- Native notifications request Android permission when enabled.
- Streaming Tauri requests share a native Rust HTTP client and support cancellation.

Desktop-only process features remain unavailable on Android: embedded Python/GGUF execution and stdio MCP servers. Remote APIs, HTTP MCP servers, and LAN model servers remain supported.

## Emulator coverage

The manual smoke profile performs the following checks against the x86_64 debug APK:

1. Verify APK signature, page alignment, target SDK, ABI, and size.
2. Install with `adb install --no-streaming -r` and require `Success`.
3. Resolve and launch the real launcher activity, then require a live process.
4. Confirm `database.bin` exists, force-stop the app, relaunch it, and confirm the file remains.
5. Exercise the `risuailocal://` intent filter.
6. Fail on app-process crashes or ANRs and upload logcat, screenshot, package, and activity diagnostics.

This smoke test proves packaging, installation, bootstrap, and basic persistence. It does not replace real-device acceptance testing.

## Device acceptance checklist

Before publishing a release, test at least one ARM64 phone and one tablet:

1. Complete first setup, create a character, send a chat, background the app immediately, and confirm the message remains after force-stop/relaunch.
2. Import and export `.risum`, `.risup`, `.charx`, PNG cards, and a full backup through Android's document picker.
3. Restore the backup and confirm assets, chats, remote blocks, cold storage, plugins, and settings survive.
4. Open and cancel generation against a cloud provider and a LAN provider.
5. Verify the soft keyboard, rotation, gesture navigation, display cutouts, fullscreen, and every Back-button layer.
6. Grant and deny microphone and notification permissions, confirming both paths fail safely.
7. Open a `risuailocal://realm/<id>` link from both a stopped app and a running app.
