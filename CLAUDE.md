# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Branch Context

This is the `stable-version-future` branch, a fork of `kwaroran/RisuAI` (`upstream/main`). Custom modifications are documented in `CUSTOM_CHANGES.md`. When resolving merge conflicts after upstream sync, refer to that file for reapply guides.

## Build & Dev Commands

```bash
# Development server (web)
pnpm dev

# Production build (requires increased memory for large bundle)
NODE_OPTIONS="--max-old-space-size=6144" pnpm run build

# Type checking (svelte-check)
pnpm check

# Run tests (vitest)
pnpm test

# Run Node.js self-hosted server
pnpm runserver

# Tauri desktop build (requires Rust/Cargo)
pnpm tauribuild && pnpm tauri build
```

## Tech Stack

- **Svelte 5** with Runes (`$state`, `$derived`, `$effect`) + TypeScript (strict=false)
- **Vite 7** bundler, **Tailwind CSS 4**
- **Tauri 2.5** for desktop (Rust backend in `src-tauri/`)
- **pnpm** package manager

## Architecture

Risuai is a cross-platform AI chat application supporting multiple providers (OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, etc.).

### Core Data Flow

```
User input → process/index.svelte.ts (sendChat)
  → Build prompt (lorebook, memory, persona, templates)
  → process/request/request.ts (provider router)
  → Provider handler (anthropic.ts | google.ts | openAI/requests.ts)
  → SSE stream → TransformStream (getTranStream) → wrapToolStream
  → Streaming reader loop in index.svelte.ts → DBState update → UI
```

### State Management

- `DBState` (in `storage/database.svelte.ts`) holds the entire database via `$state` rune
- UI state uses Svelte stores in `stores.svelte.ts`: `selectedCharID`, `settingsOpen`, `sideBarStore`, `MobileGUI`
- No router; `App.svelte` uses conditional rendering based on store values

### Streaming Pipeline (Critical Path)

The SSE streaming system is the most complex and bug-prone area:

1. **SSE Parsing** (`getTranStream` in google.ts / openAI/requests.ts): `TransformStream` with line-based buffering. `parseLines()` is extracted externally with `accumulated` state. `flush()` handler processes remaining buffer on stream end.

2. **Stream Piping**: `pipeTo(writable, { preventAbort: true })` with `.catch()` for manual close on error. This ensures `flush()` runs even when the source stream errors.

3. **Tool Wrapping** (`wrapToolStream`): Reads from TransformStream, handles tool calls with re-requests, enqueues formatted chunks. Uses `lastValue` pattern to capture final flush output.

4. **Consumer** (`index.svelte.ts:1530+`): Reader loop writes each chunk to `DBState` through Svelte `$state` proxy. After loop, final chunk is re-applied from `lastResponseChunk` to guard against proxy sync issues, then `structuredClone` breaks the proxy chain before post-processing.

5. **Anthropic** uses a different pattern: direct `ReadableStream` with `i--; text = prevText` deferred parsing. On `done: true`, deferred events must be re-processed.

### Storage Layer

Multi-backend abstraction (`storage/`): Tauri FS, LocalForage, OPFS, Node.js, AccountStorage. Save format is block-based RISUSAVE (header + per-block compressed JSON).

### NodeStorage Diff Save System

For the self-hosted Node.js server (`pnpm runserver`), saves use a **diff-based incremental protocol** to avoid sending the entire database on every save:

1. **Block Storage**: Server stores individual RISUSAVE blocks in `save/__dbblocks/` with a `__manifest.json` tracking hashes and sizes.
2. **Save Flow**: `RisuSaveEncoder.set()` tracks changed blocks → `saveDb()` calls `saveDiff()` with only changed blocks + SHA-256 hashes → server validates and writes atomically.
3. **Load Flow**: `bootstrap.ts` fetches manifest → `getBlocks()` for all blocks → reassembles RISUSAVE format → `decodeRisuSave()`.
4. **Backward Compat**: `GET /api/save-capabilities` probes server support. If 404, falls back to monolithic full-file save via existing `/api/write`.
5. **Migration**: First `save-diff` call auto-migrates existing monolithic `database.bin` to block storage.

### Plugin System (API v3.0)

Iframe-sandboxed plugins with SafeDocument/SafeElement wrappers. Can add custom AI providers. See `plugins.md` for development guide. This branch also supports legacy API v2.0 plugins.

### Server (`server/node/server.cjs`)

Express proxy that forwards requests to AI APIs. Handles CORS, keepalive connections (15s interval), stream passthrough with `pipeline()`, and gzip compression for saves.

## Key Files

| File | Role |
|------|------|
| `src/ts/process/index.svelte.ts` | Main chat orchestration, streaming consumer |
| `src/ts/process/request/request.ts` | Provider routing |
| `src/ts/process/request/google.ts` | Google Gemini SSE parser + tool stream |
| `src/ts/process/request/openAI/requests.ts` | OpenAI SSE parser + tool stream |
| `src/ts/process/request/anthropic.ts` | Anthropic Claude streaming |
| `src/ts/storage/database.svelte.ts` | Database types and DBState |
| `src/ts/stores.svelte.ts` | UI state stores |
| `src/ts/globalApi.svelte.ts` | Global API (save, fetch, platform detection) |
| `src/ts/plugins/plugins.svelte.ts` | Plugin loader |
| `server/node/server.cjs` | Node proxy server |

## File Naming

- `.svelte.ts` = Svelte 5 module with runes (not a component)
- `.svelte` = Svelte component
- camelCase for files

## Upstream Sync

See `CUSTOM_CHANGES.md` for the full procedure. Key points:
- Use **merge** (not rebase) to avoid re-resolving conflicts
- Build must use `NODE_OPTIONS="--max-old-space-size=6144"`
- Conflict-prone files are listed in `CUSTOM_CHANGES.md`
