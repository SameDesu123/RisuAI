# Node-only Split Save Database Plan

## Goal

Implement a single PR that reduces startup cost for the Node server environment by splitting the save database into smaller files. Web, Tauri, account sync, and OPFS/LocalForage storage should keep the existing monolithic save path.

The goal is to make Node-hosted Risuai avoid reading and decoding the entire `database/database.bin` on every launch once the database has migrated to the split layout.

This plan intentionally targets only `isNodeServer` because the Node storage layer already exposes generic key-value file APIs through `NodeStorage`. That lets the client write multiple logical files without changing browser backends or web hosting storage.

## Current situation

`NodeStorage` already supports arbitrary storage keys through these methods:

- `setItem(key, value)` -> `POST /api/write`
- `getItem(key)` -> `GET /api/read`
- `keys()` -> `GET /api/list`
- `removeItem(key | key[])` -> `GET /api/remove`

The key is encoded into the `file-path` header, so client-side code can store additional files such as `database/split/root.bin` or `database/split/characters/<chaId>.bin` without adding new server routes.

The existing save encoder already has a block-oriented format, but the current save path still effectively makes character data a large unit. For this PR, do not attempt a cross-platform save format redesign. Add a Node-specific split persistence layer instead.

## Scope

In scope:

- Add Node-only split save/load path behind `isNodeServer`.
- Keep the existing monolithic save file as fallback and migration source.
- Create a split manifest/root file for fast startup.
- Store full character records separately.
- Optionally store individual chat blocks separately if implementation remains manageable.
- Add lazy character hydration before opening a character.
- Add boot/save instrumentation for the new path.
- Preserve existing Node server API routes.

Out of scope:

- Changing web, Tauri, LocalForage, OPFS, or account sync behavior.
- Requiring backend API changes.
- Removing existing `database/database.bin` support.
- Full lazy loading for every feature in the app.
- Changing import/export file formats.

## Proposed storage layout

Use NodeStorage keys under a dedicated namespace:

```txt
database/split/v1/root.bin
database/split/v1/characters/<chaId>.bin
database/split/v1/chats/<chaId>/<chatId>.bin   # optional, see below
database/split/v1/meta.json
```

`meta.json` should contain enough information to detect format support and migration state:

```ts
type NodeSplitMeta = {
  type: 'risu-node-split-save'
  version: 1
  createdAt: number
  updatedAt: number
  rootKey: string
}
```

`root.bin` should contain a normal encoded object, not a new binary format. Keep the implementation boring on purpose. Boring code is less likely to bite someone at 3 AM.

```ts
type NodeSplitRoot = Omit<Database, 'characters'> & {
  characters: NodeSplitCharacterStub[]
  __nodeSplitSave?: {
    version: 1
    migratedFromMonolith?: boolean
    lastFullSaveAt?: number
  }
}

type NodeSplitCharacterStub = {
  __nodeSplitStub: true
  chaId: string
  type: 'character' | 'group'
  name: string
  image?: string
  chatPage: number
  chatCount: number
  lastInteraction?: number
  tags?: string[]
  trashTime?: number
  coldstorage?: string
}
```

Each `characters/<chaId>.bin` should contain the full character object. This means phase one lazy-loads at the character level, not the chat level.

Chat-level split can be added in the same PR only if character-level split is stable early. Otherwise leave it as a documented follow-up.

## Why character-level split first

Character-level split gives most of the startup benefit with much lower compatibility risk:

- Sidebar needs only name, image, order, and basic metadata.
- `changeChar(index)` is already a natural hydration boundary.
- Most features that need full chats are used after a character is selected.
- Avoids rewriting every feature that assumes `character.chats` exists.

Chat-level split is more invasive because export, search, bookmark list, memory, lorebook, and chat switching may all assume complete chat arrays.

## Load flow

### Node split fast path

When `isNodeServer` is true:

1. Initialize `forageStorage` as usual.
2. Check for `database/split/v1/meta.json`.
3. If present, read `database/split/v1/root.bin`.
4. Decode root into a partial `Database` object with character stubs.
5. Call `setDatabase(rootDb)`.
6. Run required format/default checks that are safe for stubs.
7. Set `loadedStore` when the partial DB is safe to render.
8. Hydrate a character only when it is selected or explicitly needed.

### Fallback path

If split metadata or root is missing/corrupt:

1. Fall back to existing `database/database.bin`.
2. Decode with the existing `decodeRisuSave` path.
3. Call `setDatabase(decoded)`.
4. Continue normal boot.
5. Schedule split-save migration after the app is usable.

This preserves compatibility with all existing Node deployments.

## Save flow

When `isNodeServer` is true and split save is enabled:

1. Build root DB by replacing full characters with stubs.
2. Write `database/split/v1/root.bin`.
3. Write changed full character objects to `database/split/v1/characters/<chaId>.bin`.
4. Write `database/split/v1/meta.json` last.
5. Optionally write a monolithic compatibility snapshot at a lower frequency or behind a setting.

Writing `meta.json` last makes incomplete migrations easier to detect. If root/character writes fail, the loader should ignore the split path and fall back to monolith.

## Hydration API

Add a small Node-only hydration helper, probably in a new file such as:

```txt
src/ts/storage/nodeSplitSave.svelte.ts
```

Suggested API:

```ts
export function isNodeSplitCharacterStub(value: unknown): value is NodeSplitCharacterStub

export async function loadNodeSplitRoot(): Promise<Database | null>

export async function saveNodeSplitDatabase(db: Database, options?: {
  changedCharacterIds?: string[]
  writeCompatibilitySnapshot?: boolean
}): Promise<void>

export async function ensureNodeSplitCharacterLoaded(index: number): Promise<void>

export async function migrateMonolithToNodeSplit(db: Database): Promise<void>
```

`changeChar(index)` should call `ensureNodeSplitCharacterLoaded(index)` before `characterFormatUpdate(index)`. This keeps most lazy-load behavior behind one existing user action.

Implementation sketch:

```ts
export async function ensureNodeSplitCharacterLoaded(index: number) {
  if (!isNodeServer) return

  const char = DBState.db.characters[index]
  if (!isNodeSplitCharacterStub(char)) return

  const raw = await forageStorage.getItem(`database/split/v1/characters/${char.chaId}.bin`)
  if (!raw) {
    throw new Error(`Missing split character data: ${char.chaId}`)
  }

  const loaded = await decodeNodeSplitBlock(raw)
  DBState.db.characters[index] = loaded
}
```

## Encoding format for split blocks

For the first PR, use simple JSON + optional compression helpers instead of extending `RisuSaveEncoder`.

Suggested helpers:

```ts
async function encodeNodeSplitBlock(value: unknown): Promise<Uint8Array>
async function decodeNodeSplitBlock<T>(data: Uint8Array): Promise<T>
```

Use a small header so blocks are recognizable:

```txt
RISU_NODE_SPLIT_V1\0 + json-or-compressed-json
```

Keep this separate from the existing save format to avoid accidentally making all platforms parse Node-only blocks.

## Migration strategy

Migration should be one-way for the Node split path but non-destructive:

1. Load existing monolithic DB normally.
2. After UI is usable, write split root + character files.
3. Keep `database/database.bin` intact during initial migration.
4. On later saves, use split save as the primary Node path.
5. Optionally keep writing monolith periodically as an emergency compatibility backup.

Do not delete the monolithic DB in this PR. Deleting old data in a migration PR is how software develops folklore.

## Dirty tracking

Start conservative:

- If selected character changes, save that full character file.
- If root-level settings change, save root.
- If unsure, rewrite all character split files in the background.

A later optimization can wire `changeTracker.character` into `saveNodeSplitDatabase()`. The first implementation should prioritize correctness over perfect minimal writes.

## Boot instrumentation

Add timing logs for the Node split path:

- split meta read
- split root read
- split root decode
- fallback monolith read
- fallback monolith decode
- split migration write
- character hydration read/decode

Suggested format:

```ts
console.debug('[node-split-save]', label, `${elapsed.toFixed(1)}ms`)
```

## Safety rules

- If split root fails to load, fall back to monolith.
- If a character block fails to load, show a recoverable error and do not overwrite the stub.
- Write split `meta.json` only after root and character writes succeed.
- Never delete `database/database.bin` in this PR.
- Do not enable split save outside `isNodeServer`.
- Avoid running migration while a generation/import/export operation is active.

## Files likely to change

Expected frontend changes:

```txt
src/ts/bootstrap.ts
src/ts/globalApi.svelte.ts
src/ts/characters.ts
src/ts/storage/nodeSplitSave.svelte.ts
src/ts/storage/nodeStorage.ts              # likely no logic change, maybe types/comments only
```

Possibly touched if dirty tracking is wired in:

```txt
src/ts/storage/risuSave.ts
src/ts/storage/database.svelte.ts
src/ts/process/coldstorage.svelte.ts
```

Expected backend changes:

```txt
none
```

The existing Node API should already support the required key-value storage.

## Test plan

Manual tests:

1. Start Node server with no existing database.
2. Start Node server with existing monolithic `database/database.bin`.
3. Confirm first run migrates to split files after successful load.
4. Restart and confirm split root loads without decoding full monolith.
5. Select several characters and confirm hydration works.
6. Edit a chat, reload, and confirm changes persist.
7. Edit root settings, reload, and confirm settings persist.
8. Corrupt or remove split root, confirm fallback to monolith.
9. Remove one character split file, confirm recoverable error instead of destructive overwrite.
10. Confirm web/Tauri behavior is unchanged.

Automated checks if practical:

- `pnpm check`
- unit-level encode/decode test for node split blocks
- migration helper test using a synthetic large DB object

## Success criteria

- Node split save is used only when `isNodeServer` is true.
- Existing Node saves still load through fallback.
- After migration, restart reads split root first.
- UI can render from stubs before full character hydration.
- Selecting a character hydrates it before normal character initialization.
- Web/Tauri/account storage behavior is unchanged.
- No data deletion is performed as part of migration.

## Follow-ups

After the character-level split is stable:

1. Add chat-level split for very large single characters.
2. Add manifest indexes for search/bookmarks without full hydration.
3. Add a UI/debug indicator for split save status.
4. Decide whether monolithic compatibility snapshots should be periodic, manual, or disabled by default.
