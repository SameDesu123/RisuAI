# Android port

RisuAI's Android app uses Tauri 2 and keeps its primary database, assets, remote blocks, and cold-storage records in the application's private `AppData` directory. Android builds are intentionally produced only by GitHub Actions; a local Android SDK, NDK, Gradle, or emulator is not required for normal development.

## Build artifacts

The `Android Build` workflow runs on pushes to `production` and Android feature branches, on relevant pull requests, and by manual dispatch.

It publishes:

- `RisuAI-Android-debug-v<version>`: an installable arm64/x86_64 debug APK signed with the runner's disposable debug key.
- `RisuAI-Android-unsigned-v<version>`: unsigned release APK and AAB files for all Tauri Android ABIs.
- `RisuAI-Android-emulator-diagnostics`: a startup screenshot and logcat output from the API 35 emulator smoke test.

The unsigned release files are suitable for build validation and later signing. Google Play and normal release APK installation require a persistent release/upload key, which is deliberately not configured here.

## CI build flow

1. Install Node 24, pnpm 10.34.1, Java 17, Rust 1.93.0, Android SDK 36, and NDK 28.2.
2. Install dependencies with the frozen pnpm and Cargo lockfiles.
3. Run `pnpm check`.
4. Generate `src-tauri/gen/android` with `pnpm tauri android init --ci`.
5. Add microphone permissions, keyboard resize behavior, and verify the generated target SDK.
6. Build and validate the debug APK, including its signature, target SDK, ZIP integrity, and 16 KB page alignment.
7. Build and validate unsigned release APK/AAB artifacts.
8. Install the x86_64 debug APK in an API 35 emulator, launch and restart it, verify `database.bin` survives, exercise the custom deep link, and fail on startup crashes or ANRs.

## Android behavior

- Android starts in the mobile UI automatically.
- System bars, display cutouts, dynamic viewport height, and keyboard resizing are handled separately from desktop window behavior.
- The Android Back button closes the focused input, modal, settings layer, sidebar, or active chat before exiting.
- Database writes are flushed when the app is backgrounded and use a temporary file plus atomic replacement.
- Imports use Android document/content URIs. Exports use the system save-document dialog instead of writing directly to a hidden app-specific Downloads folder.
- Native notifications request Android notification permission when the user enables them.
- Custom `risuailocal://` links work at cold start and while the app is already running.
- Native streaming requests honor AbortSignal cancellation.

Desktop-only process features remain deliberately unavailable on Android: embedded Python/GGUF execution and stdio MCP servers. Remote APIs, HTTP MCP servers, and LAN model servers remain supported.

## Device acceptance checklist

Before publishing a signed release, test at least one phone and one tablet:

1. Complete first setup, create a character, send a chat, background the app immediately, and confirm the message remains after force-stop/relaunch.
2. Import and export `.risum`, `.risup`, `.charx`, PNG cards, and a full backup through the Android document picker.
3. Restore the backup and confirm assets, chats, cold storage, plugins, and settings survive.
4. Open and cancel generation against a cloud provider and a LAN provider.
5. Verify the soft keyboard, rotation, gesture navigation, a display cutout, immersive fullscreen, and every Back-button layer.
6. Grant and deny microphone and notification permissions, confirming both paths fail safely.
7. Open a `risuailocal://realm/<id>` link from both a stopped app and a running app.
