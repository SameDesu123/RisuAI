# Android Tauri MVP

## Goal

The first Android MVP is not a finished Android app. The goal is to boot the existing RisuAI UI inside Tauri Android and establish a durable storage path for new Android installs.

This MVP keeps desktop Tauri and web storage behavior unchanged. Desktop Tauri still uses the existing AppData `database/`, `assets/`, and `remotes/` paths. Web still uses the existing OPFS to localforage fallback.

## Current Status

- `pnpm tauri android init --ci --skip-targets-install` was attempted for this checkout.
- The local machine has `adb`, but `ANDROID_HOME` and `NDK_HOME` are not configured, so the CLI could not generate `src-tauri/gen/android`.
- After Android Studio, SDK, NDK, and Rust Android targets are installed, rerun `pnpm tauri android init --ci --skip-targets-install` from the repo root.

## Storage Direction

Android Tauri uses `TauriAppDataStorage` through `AutoStorage`.

Selection order:

1. AccountStorage when account sync is already active.
2. NodeStorage in Node server mode.
3. TauriAppDataStorage on Android Tauri.
4. Existing OPFS to localforage fallback everywhere else.

`TauriAppDataStorage` writes into Tauri `BaseDirectory.AppData`, which maps to the app-specific internal storage area on Android. It stores keys as UTF-8 to hex filenames under `storage/`, matching the OPFS storage convention so keys containing slashes such as `database/database.bin` remain safe as file names.

Android paths currently moved to this storage:

- `database/database.bin`
- internal database backups
- key-addressed assets saved through `saveAsset`
- remote RisuSave blocks
- cold storage records

## Why Not localforage or OPFS on Android

Android WebView IndexedDB/localforage/OPFS are WebView-managed data stores, not the app's primary native data directory. For RisuAI, the primary database and assets can become large and must survive as app-owned data with predictable file-level access from Tauri APIs.

Using AppData gives Android a native storage boundary first, while avoiding a larger schema migration in this MVP. Existing localforage/OPFS migration is intentionally deferred.

## Unsupported or TODO

- TODO: Generate and validate `src-tauri/gen/android` after `ANDROID_HOME` and `NDK_HOME` are available.
- TODO: Test import/export file picker behavior on Android, including `.risum`, `.risup`, and `.charx` flows.
- TODO: Rework backup/restore UX around Android document providers and scoped storage expectations.
- TODO: Validate local asset display. Android MVP currently reads key-addressed assets back from AppData storage; asset protocol behavior still needs device testing.
- TODO: Handle the Android hardware/software back button instead of assuming desktop navigation semantics.
- TODO: Audit soft keyboard viewport resizing in chat input, modal, and settings views.
- TODO: Check TTS/STT support and permission prompts on Android.
- TODO: Check notification/background execution limits before enabling background chat, sync, or long-running tasks.
- TODO: Measure large `database.bin` read/write and backup rotation on real devices.
- TODO: Decide whether plugin sandbox helper storage that still uses localforage should move to AppData or remain WebView-scoped.
- TODO: Implement one-time migration from any legacy Android localforage/OPFS data after the fresh-install path is verified.

## Suggested Next Steps

1. Install Android Studio SDK components, set `ANDROID_HOME` and `NDK_HOME`, and add Rust Android targets.
2. Rerun `pnpm tauri android init --ci --skip-targets-install`.
3. Run `pnpm tauri android dev` on an emulator or device and confirm the Risu UI reaches first setup.
4. Create a character, save an asset, reload the app, and confirm `database/database.bin` and `assets/...` keys persist through `TauriAppDataStorage`.
5. Validate import/export and backup/restore separately before treating Android as data-safe.
