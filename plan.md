# Initial Loading Performance Plan

## Goal

Reduce the time from app launch to first usable UI by splitting startup work into safer stages, measuring the current bottlenecks, and preparing a longer-term path toward lazy database loading.

The immediate goal is not to rewrite the save format. The first target is to make the app visible and interactive sooner while preserving existing save compatibility.

## Current assumptions

The current boot path appears to do too much before the app is marked as loaded:

1. Read `database/database.bin`.
2. Decode the full save file.
3. Call `setDatabase(decoded)`.
4. Run format and state updates.
5. Run post-load tasks such as cold storage maintenance, plugin loading, module updates, dynamic model registration, and save initialization.
6. Only then set `loadedStore` to true.

This means users with large character/chat databases wait for the entire database and several non-critical tasks before reaching the UI.

## Non-goals for the first pass

- Do not change the save file format in the first PR.
- Do not introduce chat-level lazy loading before measuring the current boot cost.
- Do not remove existing backup or corruption recovery paths.
- Do not change cold storage semantics in a way that risks data loss.
- Do not rely on one platform only; web, Tauri, and node-server behavior must remain valid.

## Phase 0: Add boot timing instrumentation

Purpose: identify whether startup is dominated by storage read, save decode, database normalization, cold storage, plugin loading, or UI setup.

Add lightweight `performance.now()` logging around these steps in `loadData()`:

- storage initialization
- database file read
- `decodeRisuSave`
- `setDatabase`
- account sync checks
- service worker registration
- plugin loading
- account data loading
- `checkNewFormat`
- theme/UI state updates
- `makeColdData`
- `assignIds`
- `registerModelDynamic`
- `saveDb`
- `moduleUpdate`
- `loadedStore.set(true)`

Suggested helper:

```ts
const bootPerf = {
  start: performance.now(),
  mark(label: string) {
    console.debug(`[boot] ${label}`, `${(performance.now() - this.start).toFixed(1)}ms`)
  }
}
```

Acceptance criteria:

- Boot logs clearly show where time is spent.
- No behavior changes except extra debug logging.
- Logs can be disabled or left as `console.debug`.

## Phase 1: Split critical startup from post-load work

Purpose: show the main UI as soon as the database is safe enough to use.

Critical startup should include only:

- storage initialization
- local or remote database read required for the selected storage mode
- save decode
- `setDatabase`
- required format migration and integrity checks
- required ID assignment
- language/theme/text CSS setup
- GUI size/height mode setup
- mobile GUI decision
- setting `loadedStore` to true

Post-load work should be deferred:

- cold storage maintenance
- update checks
- dynamic model registry
- non-critical plugin initialization where possible
- module refreshes that are not required for first paint
- TOS alert display
- backup cleanup, when it is not part of corruption recovery

Implementation sketch:

```ts
async function loadData() {
  if (get(loadedStore)) return

  try {
    await loadCriticalData()
    loadedStore.set(true)
    selectedCharID.set(-1)

    void runPostLoadTasks()
  } catch (error) {
    alertError(error)
  }
}
```

`runPostLoadTasks()` should catch and report errors locally so a non-critical failure does not break startup after the UI is visible.

Acceptance criteria:

- App reaches the home screen before post-load maintenance finishes.
- Existing save files still load.
- Corruption recovery still works before `loadedStore` is set.
- Errors in deferred tasks do not blank the app.

## Phase 2: Move cold storage maintenance out of blocking startup

Purpose: avoid doing large database cleanup before the first usable UI.

Current cold storage maintenance can be expensive because it scans characters and chats. It should not block first render unless the database cannot be used without it.

Plan:

1. Run `makeColdData()` only after `loadedStore` is true.
2. Prefer `requestIdleCallback` when available.
3. Fall back to delayed async execution when idle callbacks are unavailable.
4. Keep the current verification behavior before replacing hot data with cold storage placeholders.
5. Make sure user-triggered character/chat loading still calls cold storage preload paths as needed.

Implementation sketch:

```ts
function scheduleIdleTask(task: () => Promise<void> | void) {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => void task(), { timeout: 5000 })
    return
  }
  setTimeout(() => void task(), 100)
}
```

Acceptance criteria:

- Cold storage still eventually runs when enabled.
- Startup UI is not blocked by cold storage migration.
- If cold storage write or verification fails, original data remains untouched.
- Opening a cold-storaged character or chat still restores data correctly.

## Phase 3: Reduce future database size before startup

Purpose: make the next app launch faster by keeping `database/database.bin` smaller.

Instead of only cold-storaging old data during startup, consider moving cold storage maintenance to save-time or idle-time after the app is already running.

Plan:

- Add a debounced background maintenance task after saves.
- Cold-store old chats/characters incrementally.
- Process a small batch at a time.
- Avoid running maintenance while generation, import, export, sync, or active editing is in progress.
- Add a guard so maintenance does not run repeatedly in the same session without need.

Acceptance criteria:

- Large inactive chats are removed from the hot database before the next launch.
- Save correctness is unchanged.
- Maintenance can be interrupted safely.
- No user data is replaced by a cold pointer unless read-back verification succeeds.

## Phase 4: Design true lazy database loading

Purpose: avoid reading and decoding the entire database on launch.

This is a larger save format change and should be a separate design/PR series.

Proposed structure:

```txt
database/root.bin
database/manifest.bin
characters/{chaId}.bin
chats/{chaId}/{chatId}.bin
presets.bin
modules.bin
plugins.bin
pluginStorage.bin
loadouts.bin
```

Initial load would read only:

- root settings
- character manifest
- character order
- minimal UI preferences
- selected language/theme data

Character manifest example:

```ts
type CharacterManifestEntry = {
  chaId: string
  type: 'character' | 'group'
  name: string
  image: string
  chatPage: number
  chatCount: number
  lastInteraction?: number
  tags?: string[]
  folder?: string
}
```

Lazy load flow:

1. Boot reads root settings and manifest.
2. Sidebar renders from manifest.
3. User selects a character.
4. App loads `characters/{chaId}.bin`.
5. App loads the current chat block only.
6. Other chats are loaded when opened or when a feature explicitly requires all chats.

Required save/decoder changes:

- Implement real chat block support.
- Stop storing all chats inside every character block.
- Add migration from existing `CHARACTER_WITH_CHAT` blocks.
- Add compatibility decode path for older saves.
- Add remote block support for character/chat-level data.
- Add recovery behavior when a child block is missing.

Acceptance criteria:

- Existing saves decode and migrate safely.
- New saves can start from manifest without decoding all chats.
- Missing lazy blocks produce recoverable errors rather than crashes.
- Export/import paths still work when all chats are not preloaded.
- Search, bookmark, lorebook, memory, sync, and backup features either preload required data or operate on indexed metadata.

## Phase 5: Tests and manual validation

Add or run checks for:

- fresh empty save
- legacy save
- large save with many characters
- large character with many chats
- cold-storaged character
- cold-storaged chat
- account sync enabled
- Tauri local filesystem
- web LocalForage/OPFS
- node-server storage
- corrupted primary DB with backup recovery
- plugin-enabled database

Manual timing test matrix:

| Scenario | Metric |
| --- | --- |
| Small DB | time to loading screen removal |
| Medium DB | time to first home screen |
| Large DB | time to sidebar visible |
| Large cold-storage DB | time to selected character open |
| Tauri | database read + decode time |
| Web | LocalForage/OPFS read + decode time |

## Risks

- Moving `loadedStore.set(true)` too early can render components before required DB defaults exist.
- Deferring plugin loading may break plugin-defined UI if menus expect plugin registration immediately.
- Deferring module updates may temporarily show stale module state.
- Moving cold storage to background can race with save/export/import if not guarded.
- True lazy loading affects many features that assume `DBState.db.characters[*].chats` is fully available.

## Rollback plan

Each phase should be separately reversible.

- Phase 0 can be reverted by removing instrumentation.
- Phase 1 can restore the old `loadData()` ordering.
- Phase 2 can move `makeColdData()` back before `loadedStore`.
- Phase 3 can disable save-time maintenance behind a feature flag.
- Phase 4 must be guarded by save format versioning and compatibility decode paths.

## Recommended PR order

1. Add boot instrumentation.
2. Split critical startup and post-load tasks without changing behavior-critical ordering.
3. Defer cold storage maintenance until after first UI.
4. Add save-time or idle-time cold storage maintenance to keep future DBs small.
5. Draft a separate design for manifest-based lazy DB loading.
6. Implement lazy DB loading behind an experimental flag.

## Open questions

- Which startup step is actually slowest on a real large user database?
- Should plugin loading be considered critical for first render?
- Is the sidebar allowed to render before all plugin-defined menus are registered?
- Should cold storage be enabled by default for large databases?
- Can character search operate on manifest metadata only?
- How should export-all-chats behave when many chats are lazy-loaded?
