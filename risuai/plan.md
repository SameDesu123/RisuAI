## Frontend optimization investigation plan

This file captures the current frontend optimization findings and the next investigation focus.

### Current top-priority findings

1. `src/ts/observer.svelte.ts`
   - The DOM observer path is effectively polling with `while(true)` instead of relying on a live `MutationObserver`.
   - The same nodes appear eligible for repeated listener attachment, so CPU churn and listener duplication are likely.

2. `src/ts/globalApi.svelte.ts`
   - `saveDb()` maintains an always-on async loop and broad reactive tracking over database state.
   - This looks like an app-wide idle overhead source and a likely contributor to unnecessary serialization work.

3. App shell eager imports
   - `src/App.svelte`, `src/lib/Setting/Settings.svelte`, and `src/lib/Mobile/MobileBody.svelte` eagerly import many large surfaces that are only needed conditionally.
   - Existing lazy-loading patterns already exist elsewhere and can likely be extended here.

4. Chat process import graph
   - `src/lib/ChatScreens/DefaultChatScreen.svelte` imports `sendChat` directly from `src/ts/process/index.svelte.ts`.
   - That path appears to connect early chat UI to memory, embedding, WebLLM, and transformers-related code.

5. Sidebar to transformers import graph
   - `src/lib/SideBars/CharConfig.svelte` imports `registerOnnxModel` from `src/ts/process/transformers.ts`.
   - A commonly mounted sidebar surface may therefore drag ML-related code into earlier chunks than necessary.

### Investigation scope for this phase

Only the five items above are in scope right now.

Each item is being investigated independently with a dedicated sub-agent. The goal is to produce:

- the exact import/render/reactivity path,
- why the cost happens,
- how risky the optimization would be,
- and the cleanest implementation direction.

### Progress

Completed investigations:

1. Observer polling path
   - `src/ts/observer.svelte.ts` creates a `MutationObserver` but never calls `observe()`.
   - The active behavior is a `while(true)` loop that scans the whole document every 100ms.
   - `nodeObserve()` can repeatedly attach `contextmenu` listeners to the same code block nodes, creating likely CPU and memory leaks over time.
   - `startObserveDom()` is started from bootstrap and currently has no internal single-run guard or cleanup path.

2. App shell eager imports
   - `src/App.svelte` eagerly imports many mutually exclusive surfaces such as `Settings`, `Sidebar`, `HypaV3Modal`, `IrisModal`, and mobile-only shells.
   - `src/lib/Setting/Settings.svelte` eagerly imports all settings pages even though only one tab is rendered at a time.
   - `src/lib/Mobile/MobileBody.svelte` eagerly imports `Settings`, `CharConfig`, `DevTool`, `RealmMain`, and `ChatScreen` even though they are stack-gated.
   - Existing lazy-loading patterns already exist in the codebase (`PopupEditor`, `PlaygroundMenu`, `TriggerV1List`) and can be reused.

3. Save loop / reactive tracking
   - `src/ts/globalApi.svelte.ts` starts `saveDb()` from bootstrap and `saveDb()` itself has no singleton guard.
   - The current implementation keeps an always-on loop alive with 500ms wakeups even when the app is idle.
   - The largest cost is not the timer itself but the broad `$effect` tracking that snapshots and deep-clones large parts of `DBState.db` purely to establish reactivity.
   - `changeTracker.loadouts`, `changeTracker.plugins`, and `changeTracker.pluginCustomStorage` are not reset after save, so they remain hot and keep being re-encoded.
   - Every save cycle also writes both the main DB and a backup, then scans backup storage again for pruning.

4. Chat UI -> process import graph
   - `src/lib/ChatScreens/DefaultChatScreen.svelte` statically imports `sendChat`, `doingChat`, and `chatProcessStage` from `src/ts/process/index.svelte.ts`.
   - That pulls a broad runtime graph into the early frontend bundle, including request handling, memory systems, TTS, image embedding, and the local inference bridge.
   - Some very heavy libraries are already deferred correctly with `await import(...)`, but the module graph itself is still entered too early.
   - The biggest structural win is likely a thin `index.core` style boundary that exposes lightweight stores immediately and lazy-loads the actual send pipeline on first use.

5. Sidebar / CharConfig -> transformers graph
   - `src/lib/SideBars/Sidebar.svelte` statically imports `CharConfig.svelte`, and `CharConfig.svelte` statically imports `registerOnnxModel` from `src/ts/process/transformers.ts`.
   - This path by itself is not the main reason `transformers.ts` enters early, because core process modules already pull it in.
   - The more meaningful optimization here is not splitting `transformers.ts` from `CharConfig`, but lazy-loading `CharConfig.svelte` itself from `Sidebar.svelte`, since `CharConfig` is large and only rendered when bot-maker mode is active.

All five priority investigations are now complete.

### Expected next output

After the parallel investigations finish, the results should be merged into:

1. confirmed root causes,
2. likely impact,
3. implementation order,
4. and any coupling between the five priority items.

## Next investigation phase: rendering / reactivity hot paths

This phase focuses only on the highest-probability rendering and reactive churn paths found during the first sweep.

### In-scope hot-path targets

1. `src/lib/ChatScreens/ChatBody.svelte`
   - Check duplicate `ParseMarkdown()` work, translation branches, and image post-processing.

2. `src/ts/parser/parser.svelte.ts`
   - Check the core markdown/asset/script/highlight/sanitize pipeline and whether caching boundaries are viable.

3. `src/lib/ChatScreens/Chats.svelte`
   - Check the manual hash-based DOM diffing and component mount/unmount strategy.

4. `src/lib/ChatScreens/DefaultChatScreen.svelte`
   - Check scroll-to-message, autoscroll, image-waiting, and page loading behavior.

5. `src/lib/ChatScreens/Chat.svelte`
   - Check the overall reactive surface, snippet structure, and whether the component is too broad for efficient updates.

### Method

Use one dedicated sub-agent per hot-path target, then merge the results into:

1. confirmed root causes,
2. likely runtime impact,
3. safest optimization boundaries,
4. and implementation ordering across the chat rendering stack.

### Progress

Completed hot-path investigations:

1. `DefaultChatScreen.svelte` scroll / autoscroll path
   - `scrollToMessage()` expands `loadPages`, then polls the DOM up to 50 times with 100ms sleeps before it can scroll to a target message.
   - After locating the message, it still does a full `.default-chat-screen img` scan, waits on every image or a 4s timeout, and then calls `scrollIntoView()` multiple times.
   - The same screen also has an unthrottled `onscroll` handler that reads layout on every scroll event and may grow `loadPages`, which feeds back into chat rerender work.
   - `Chats.svelte` compounds the cost because its main `$effect` interleaves layout reads, manual DOM reconciliation, and delayed auto-scroll behavior.
   - The safest first fixes here are replacing the polling loop with observer-based readiness, throttling the scroll handler, and collapsing the repeated `scrollIntoView()` / image-wait sequence.

2. `Chats.svelte` manual DOM reconciliation
   - The current hash-based reconciler is optimized for the case where most visible messages do not change, so it can skip remounting heavy `Chat` subtrees.
   - But hash hits also mean mounted `Chat` instances do not receive fresh props, so values like usernames, avatars, callbacks, and total-length context can go stale.
   - The reconciliation loop still does DOM queries for inserts/removals, allocates fresh character summary objects, and runs in the same effect path as auto-scroll checks.
   - Because the hash includes the message index, insertions in the middle of history can invalidate many following rows and trigger avoidable remount churn.
   - The safest fixes here are restoring prop freshness first, reducing stale-node ordering risk in the insert/remove passes, and memoizing non-message props before considering larger rendering architecture changes.

3. `ChatBody.svelte` parsing / translation path
   - `ChatBody` is not just a thin parser wrapper; its translation state transitions can cause `ParseMarkdown()` to run 2-3 times for one visible message update.
   - The biggest source is the `translated` / `retranslate` bounce path, where reactive state flips feed back into the same derived async parsing routine.
   - `ChatBody` also runs extra post-processing work around each parse, including duplicate `checkImg()` scans, repeated asset-map rebuilding, and repeated sanitize/metadata wrapping work in the pending and resolved render branches.
   - The parent `Chat.svelte` `{#key}` usage appears to make this worse for the newest messages by fully recreating `ChatBody` and discarding warm parser state whenever the recent message count changes.
   - The safest near-term fixes here are breaking the translation reparse loop, removing the premature duplicate image scan, and avoiding unconditional hot-path logging before attempting larger parser caching changes.

4. `ParseMarkdown` core pipeline
   - The core parser already has several high fixed-cost stages even before UI-level reactivity is considered: `processScriptFull`, repeated CBS parsing, markdown-it rendering, syntax highlighting, DOMPurify sanitization, and asset resolution.
   - Some of the heaviest work is structurally pure enough to cache more aggressively, especially markdown rendering and code highlighting, but other parts such as CBS/script evaluation are stateful and need tighter invalidation boundaries.
   - The current system also broadens cost through invalidation: character-level asset cache resets are too coarse, script caches are cleared eagerly, and `trimMarkdown()` / sanitize work is effectively paid more than once per visible render.
   - The biggest parser-level wins now look like reducing duplicate sanitize work, caching pure markdown/highlight output, and narrowing cache invalidation before attempting deeper script-engine changes.

5. `Chat.svelte` reactive/render surface
   - `Chat.svelte` is currently the central fan-out point where global DB state, reload stores, parser entrypoints, theme/layout branching, and message actions are all read in one place.
   - Its current structure means a single message render can re-run wide parts of the template, rebuild snippet-heavy action UI, and recreate `ChatBody` through the `{#key}` path for recent messages or reload events.
   - The component also duplicates work through repeated deep `DBState` path reads, repeated `getCbsCondition()` creation, `displaya()` reruns, and render-time `RenderGUIHtml()` parsing in the custom HTML mode.
   - The safest structural wins here are extracting the icon/action bar and sender icon into separate components, narrowing repeated chat-path reads into derived locals, and replacing remount-based `ChatBody` refreshes with a narrower reload signal.

### Phase summary

All five rendering / reactivity hot-path investigations are now complete.

Most likely implementation order:

1. Break `ChatBody` translation-triggered reparsing and remove duplicate post-parse work.
2. Fix `DefaultChatScreen` scroll polling / image wait / unthrottled scroll handler.
3. Restore correctness and prop freshness in `Chats.svelte`'s manual reconciliation.
4. Narrow `Chat.svelte` reactive surface and remove unnecessary `ChatBody` remounts.
5. Add parser-level caching only after the UI-level invalidation loops are reduced.

## Next investigation phase: bundle / loading optimization

This phase focuses on initial bundle pressure, lazy-loading boundaries, and startup work that delays first-use readiness.

### In-scope loading targets

1. `src/App.svelte`, `src/main.ts`, `src/ts/bootstrap.ts`
   - Check entry-shell imports, startup gating, and whether mutually exclusive UI surfaces are loaded too early.

2. `src/lib/Setting/Settings.svelte`, `src/lib/Mobile/MobileBody.svelte`, `src/lib/SideBars/Sidebar.svelte`, `src/lib/SideBars/CharConfig.svelte`
   - Check conditional surfaces that are still statically imported and likely belong behind lazy chunk boundaries.

3. `src/lib/ChatScreens/DefaultChatScreen.svelte` and `src/ts/process/index.svelte.ts`
   - Check where chat UI currently crosses into the heavy send/process graph during first load.

4. Heavy optional frontend dependencies
   - Verify which large packages are already deferred correctly and which ones still leak into earlier chunks.

5. App startup work
   - Check bootstrap/init side effects that run eagerly and may delay interaction even when their features are not yet needed.

### Method

Use one dedicated sub-agent per loading target, then merge the results into:

1. confirmed early-loading causes,
2. likely startup/bundle impact,
3. safest lazy-boundary candidates,
4. and implementation ordering across startup and feature entry points.

### Progress

Completed bundle/loading investigations:

1. Settings / mobile / sidebar conditional surfaces
   - `Settings.svelte` statically imports its page components up front even though rendering is entirely tab-gated by `$SettingsMenuIndex`.
   - `MobileBody.svelte` eagerly imports `Settings`, `CharConfig`, and `DevTool` even though each is only shown behind stack/sidebar state.
   - `Sidebar.svelte` eagerly imports `CharConfig` and `DevTool`, while `CharConfig.svelte` itself eagerly imports large sub-surfaces like LoreBook and script/trigger editors that are only shown in specific sub-tabs.
   - The highest-value lazy boundaries here are settings-page chunks, `CharConfig` tab chunks (especially Scripts/LoreBook), and mobile-only `Settings` / `DevTool` entry points.

2. Startup work / readiness path
   - `bootstrap.ts` still performs several readiness-blocking tasks in-band before `loadedStore.set(true)`, including update checks, plugin loading, account-data loading, format checks, and cold-data work.
   - The web startup path also calls `forageStorage.checkAccountSync()` twice, with the second call's result discarded.
   - `startObserveDom()` is started after ready but still creates permanent idle cost because it runs an infinite 100ms DOM polling loop without ever attaching the created `MutationObserver`.
   - The safest startup wins here are removing duplicate sync checks, deferring network-heavy update/account/model work until after first render, and eliminating the permanent observer polling loop.

3. App shell / entry loading path
   - `main.ts` still imports broad entry dependencies synchronously, including `core-js/actual`, the database state module, `bootstrap.ts`, and `hotkey.ts`.
   - The most important widening path here is `main.ts -> hotkey.ts -> process/index.svelte.ts`, where startup hotkey registration drags the entire chat process graph into the early bundle even before the user sends anything.
   - `App.svelte` also statically imports many mutually exclusive surfaces and user-triggered modals up front, so first-run-only UI, mobile-only shells, and infrequently opened overlays all contribute to early parse/load cost.
   - Additional app-shell pressure comes from static locale imports and small but unnecessary entry assets like the keep-session-alive sound file.

4. Chat UI -> process loading boundary
   - `DefaultChatScreen.svelte` still statically imports `doingChat`, `chatProcessStage`, and `sendChat` from `process/index.svelte.ts`, but only the two stores are needed at render time.
   - That single import boundary pulls a very wide send-time graph into the first chat chunk, including request providers, triggers, memory systems, scripting/Lua, TTS, stable diffusion, and related runtime modules.
   - Existing leaf-level `await import(...)` calls are not enough because the intermediate aggregator modules still enter the chunk eagerly.
   - The highest-value split remains extracting the chat stores into a tiny module and lazy-importing `sendChat` only at first send, then progressively splitting optional subsystems like Lua, memory, TTS, and image generation behind their feature branches.

5. Heavy optional dependencies
   - Most of the biggest installed packages are already deferred correctly: Monaco, transformers, WebLLM, tokenizers, Three, pdfjs-dist, Pyodide, and Bergamot are all either dynamically imported or isolated behind workers/secondary entry points.
   - The real early-bundle leaks are smaller but still meaningful libraries that sit in central modules: `katex` and `markdown-it` in `parser.svelte.ts`, plus `wasmoon` in `scriptings.ts`.
   - Of those, `katex` is the cleanest high-value fix because it is only used at a narrow call site in an already-async render path, while `wasmoon` can also be moved behind its existing Lua factory boundary with low risk.
   - This confirms that the biggest remaining bundle issue is not the giant optional runtimes themselves, but a few medium-sized libraries that sit on central startup/process paths and therefore leak into early chunks.

### Phase summary

All five bundle / loading investigations are now complete.

Most likely implementation order:

1. Split chat stores from `process/index.svelte.ts` and lazy-import `sendChat` on first send.
2. Remove or defer the biggest entry/startup wideners: `hotkey -> process/index`, readiness-blocking update/account/model work, and duplicate account-sync checks.
3. Lazy-load conditional UI surfaces: settings pages, mobile-only settings/dev tools, and `CharConfig` sub-tabs.
4. Move `katex` and `wasmoon` behind local lazy boundaries, then trim smaller entry-only assets/locales/modals.
5. Revisit broader parser/app-shell chunking only after those structural edges are cleaned up.

## Next investigation phase: event / state management

This phase focuses on global state ownership, reload/force-refresh signals, always-on listeners, and event propagation paths that can broaden invalidation or create hard-to-reason side effects.

### In-scope state/event targets

1. `src/ts/stores.svelte.ts`
   - Check the overall global store topology, ownership boundaries, and which stores are likely too broad.

2. `src/ts/storage/database.svelte.ts` and `src/ts/globalApi.svelte.ts`
   - Check DB-backed state mutation patterns, persistence coupling, and identity churn that can fan out through reactivity.

3. Reload / force-refresh signals
   - Check `ReloadGUIPointer`, `ReloadChatPointer`, and similar state-reset signals that appear to be compensating for broad invalidation.

4. Global listeners and always-on event wiring
   - Check `hotkey.ts`, `observer.svelte.ts`, bootstrap wiring, and other global listeners for event lifecycle and cleanup quality.

5. Trigger / callback flow
   - Check `triggers.ts`, `cbs.ts`, and adjacent callback/event paths to see how runtime events propagate through chat processing and UI state.

### Method

Use one dedicated sub-agent per state/event target, then merge the results into:

1. confirmed invalidation/event root causes,
2. likely correctness and maintenance risks,
3. safest state-boundary candidates,
4. and implementation ordering across store/event cleanup work.

### Progress

Completed event/state investigations:

1. Reload / force-refresh signals
   - `ReloadGUIPointer` is currently a full-application reload hammer: a single increment clears `ReloadChatPointer`, resets script caches, retriggers message parsing across mounted chats, and remounts keyed chat/background subtrees.
   - `ReloadChatPointer` exists as a more granular per-message invalidation path, but that granularity is regularly destroyed by the broader GUI reload cascade.
   - Several producers are far too broad for the blast radius they cause, including regex editing, script variable changes, and chat-switch/folder-toggle flows.
   - The safest direction here is splitting global GUI reload into purpose-scoped signals and detaching per-message invalidation from the broad GUI pointer.

2. Global store topology
   - `DBState.db` is acting as a god-object store that mixes characters, chats, settings, modules, personas, and other app data behind one reactive proxy imported across a very large portion of the codebase.
   - Around it, several stores behave less like state and more like implicit event buses (`ReloadGUIPointer`, `ReloadChatPointer`, `ScrollToMessageStore`), while `selectedCharID` and `selIdState` duplicate the same selection signal in two reactive forms.
   - The current topology makes it easy for one broad store write to fan out into unrelated UI, parser, or module work, and several subscriptions in `stores.svelte.ts` also perform hidden side effects during what should be state synchronization.
   - The biggest structural targets here are shrinking the role of `DBState`, removing event-bus-like invalidation stores where possible, and untangling selection/module-update side effects from the central store module.

3. DBState tracking / persistence coupling
   - `DBState.db` is not only broad; several mutation helpers replace large identities more often than necessary, including full DB replacement and character-level replacement in paths that only update one chat or one plugin-managed character.
   - Persistence tracking in `saveDb()` is tightly coupled to the live reactive object through broad `for...in` scans and snapshots, so any field change can become a save trigger without an explicit ownership boundary.
   - The current shape also hides side effects in state synchronization paths, such as write-on-read style mutations during selection changes and broad module-update recomputation triggered from central store effects.
   - The safest near-term fixes here are reducing identity churn (`setCurrentChat`, plugin character writes), replacing broad save scans with deliberate tracked fields, and moving hidden DB writes out of generic store subscriptions.

4. Global listeners / always-on event wiring
   - Several global listeners are registered permanently at startup or module load and never cleaned up, including hotkeys, touch handlers, resize/message listeners, and the observer/polling path.
   - `hotkey.ts` in particular behaves like a global implicit controller: it attaches before the app is fully loaded, reads DB state for every global key event, and directly mutates many UI stores.
   - `observer.svelte.ts` remains the worst listener lifecycle issue because its permanent 100ms polling loop repeatedly reprocesses the same nodes and can accumulate duplicate DOM listeners over time.
   - The safest cleanup targets here are delaying or guarding startup listeners until the app is ready, merging overlapping touch handlers, scoping one-shot message listeners to the flows that need them, and removing permanent polling where an event-driven path already exists.

5. Trigger / callback flow
   - `runTrigger()` is effectively the central runtime event bus: user input, display processing, requests, output handling, manual UI actions, and command/script paths all converge there.
   - Inside that flow, ordinary script-variable writes are still coupled to `ReloadGUIPointer`, so local trigger effects can escalate into full GUI reloads, cache wipes, and keyed remounts far outside the original event scope.
   - The trigger stack also carries correctness risks through repeated deep cloning, recursive re-entry, duplicated `setVar` paths, and at least one concrete state bug where `CurrentTriggerIdStore` is not restored for manual-mode triggers.
   - The safest cleanup direction is to decouple generic variable changes from full GUI reload, fix the trigger-ID restore bug, reduce repeated scriptstate fan-out writes, and keep `v2UpdateGUI` as the explicit full-refresh escape hatch instead of the default side effect.

### Phase summary

All five event / state-management investigations are now complete.

Most likely implementation order:

1. Break the `ReloadGUIPointer` hammer into scoped invalidation signals and stop wiping per-message reload state on every GUI reload.
2. Reduce `DBState` identity churn and broad persistence coupling (`setCurrentChat`, plugin writes, broad save scans, hidden write-on-read paths).
3. Guard, delay, or remove the most dangerous always-on listeners, especially `observer.svelte.ts` polling and early `hotkey.ts` global handlers.
4. Decouple trigger variable updates from full GUI reload, then fix concrete trigger-state correctness bugs like `CurrentTriggerIdStore` restoration.
5. Only after that, consider larger structural refactors such as splitting `DBState` into sub-stores or breaking `runTrigger()` into smaller mode-specific dispatchers.

## Next investigation phase: additional standout findings

This phase focuses on high-signal issues that repeatedly surfaced during earlier audits but did not fit cleanly into rendering, loading, or state-management buckets.

### In-scope misc targets

1. Debug / legacy / dead-code artifacts
   - Check obvious debug logging, stale legacy files, and unreachable or footgun code paths that still affect runtime or maintainability.

2. Duplicate logic / parallel implementations
   - Check repeated helpers, duplicate algorithms, and parallel mutation paths that are likely to diverge over time.

3. Platform divergence
   - Check web vs Tauri vs mobile branching points for behavior drift, duplicated lifecycle work, or inconsistent assumptions.

4. Cache / invalidation anomalies
   - Check caches and reset paths that did not fit the previous reload-state analysis but still look suspicious or overly broad.

5. Hidden correctness bugs
   - Check for concrete, non-trivial correctness bugs that surfaced incidentally during prior audits and deserve their own grouped pass.

### Method

Use one dedicated sub-agent per misc target, then merge the results into:

1. confirmed miscellaneous root causes,
2. likely correctness/maintenance impact,
3. safest cleanup candidates,
4. and implementation ordering across these leftover high-signal items.

### Progress

Completed misc investigations:

1. Duplicate logic / parallel implementations
   - `process/index.svelte.ts` contains a high-risk duplicated prompt-template traversal: one giant switch for token counting and another for prompt construction, with already-divergent responsibilities between the two passes.
   - Emotion-history mutation is also duplicated across several script/process paths, and the penalty behavior has already drifted depending on which path updates `CharEmotion`.
   - Additional medium-signal duplicates include parallel memory-result writeback patterns, duplicated queue-flush logic in character card asset uploads, duplicated model-capability string probes, and duplicated HypaV3 initialization blocks.
   - The highest-value consolidation target here is the prompt-template traversal, because it sits on a core chat path and is already vulnerable to silent token-accounting drift when features evolve.

2. Platform divergence
   - There are several real web/Tauri/mobile differences that are intentional, but multiple branch points now look more like accidental drift than deliberate platform policy.
   - Notable examples include duplicated or asymmetric startup work across platforms, overlapping mobile touch handlers, account-mode backup asymmetry, non-reactive mobile GUI activation, and hostname-based web checks that silently exclude nightly/subdomain environments.
   - Some of these are concrete behavior bugs rather than just maintenance smells, such as the web drive-auth early-return path that can skip normal readiness completion and the unimplemented `AccountStorage.removeItem()` path that still exists behind a common storage interface.
   - The safest cleanup direction is to normalize platform guards and lifecycle expectations first, then add explicit comments or helper boundaries where truly different behavior is intentional.

3. Debug / legacy / dead-code artifacts
   - There are still numerous runtime `console.log` calls in hot or user-facing paths, including several that log full prompts, request bodies, response payloads, or account-related data rather than harmless diagnostics.
   - A few stale artifacts are also still present and importable, including explicit legacy files and orphaned/stubbed modules that are unlikely to be used intentionally but can still confuse future contributors or become accidental footguns.
   - The most urgent items here are not cosmetic logs but the ones that can leak full chat/request/account data or fire repeatedly in hot loops (`request/*`, `ChatBody`, `Chats`, slider/input handlers, Sionyw account test flow).
   - The safest cleanup direction is to remove sensitive/hot-path logging first, then prune clearly unused legacy artifacts and leave explicit comments only where a dormant path is intentionally preserved.

4. Cache / invalidation anomalies
   - Several caches outside the main reload-store analysis show asymmetry or missing cleanup, including blob URLs that are never revoked, asset URL caches that survive asset resets, fuzzy-match caches that survive script-cache resets, and file caches with no clear overwrite invalidation.
   - Some are straightforward memory/perf issues, but others are correctness-relevant because they can serve stale asset data, preserve deleted character blocks, or keep using outdated remote-existence assumptions for the rest of the session.
   - The most urgent items here are the ones with clear leak/staleness consequences: `blobUrlCache`, `fileSrcCache`, `bestMatchCache`, and the global file cache in `globalApi.svelte.ts`.
   - The safest cleanup direction is to add missing clear/revoke paths first, then add bounded eviction or config-reset behavior to the remaining session caches.

5. Hidden correctness bugs
   - Several high-confidence bugs surfaced that are stronger than design smells: `CurrentTriggerIdStore` is not restored after manual-mode triggers, `observer.svelte.ts` keeps stacking duplicate DOM listeners while its `MutationObserver` is never actually started, and imperatively mounted `Chat` instances can hold stale display props because their remount hash omits volatile identity data.
   - There is also at least one clear non-reactive UI bug where `ChatScreen.svelte` derives style data from `DBState` into a plain `const`, so settings changes do not propagate without a full reload.
   - These are useful because they are concrete, localizable fixes rather than broad architectural refactors, and several of them intersect directly with the larger reload/listener findings from earlier phases.
   - The safest direction here is to land the clearly local correctness fixes first (`CurrentTriggerIdStore`, `ChatScreen` reactive style, observer dedup/startup), then revisit the larger reconciliation/remount issues with those sharp bugs removed.

### Phase summary

All five miscellaneous investigations are now complete.

Most likely implementation order:

1. Remove sensitive/hot-path debug logging and fix the highest-confidence local correctness bugs (`CurrentTriggerIdStore`, `observer` listener stacking, `ChatScreen` non-reactive style, stale imperative chat props).
2. Fix the strongest cache/leak/staleness issues (`blobUrlCache`, `fileSrcCache`, `bestMatchCache`, `fileCache`, orphaned save-cache entries).
3. Normalize accidental platform drift and risky branch asymmetries (OAuth early-return, account storage gaps, overlapping mobile listeners, hostname/web guards).
4. Consolidate the most dangerous duplicated logic, especially the dual prompt-template traversal and duplicated emotion/state update paths.
5. After that, prune or quarantine leftover legacy/stub/dead artifacts so they stop obscuring the active architecture.
