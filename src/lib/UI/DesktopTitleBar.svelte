<script lang="ts">
    import { onMount, type Snippet } from 'svelte'
    import {
        PanelLeftIcon,
        Settings as SettingsIcon,
        MinusIcon,
        SquareIcon,
        CopyIcon,
        XIcon,
    } from '@lucide/svelte'
    import { language } from 'src/lang'
    import {
        DBState,
        selectedCharID,
        settingsOpen,
        sideBarStore,
    } from 'src/ts/stores.svelte'
    import {
        ensureDesktopTitleBarApplied,
        getTauriDesktopPlatform,
    } from 'src/ts/gui/windowChrome.svelte'
    import { isTauri } from 'src/ts/platform'
    import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

    interface Props {
        /** Reserved seat for transient status indicators (save/connection/update). */
        statusSnippet?: Snippet
    }

    let { statusSnippet }: Props = $props()

    const platform = getTauriDesktopPlatform()
    const isMac = platform === 'macos'
    const isWindowControlsPlatform = platform === 'windows' || platform === 'linux'

    const appWindow = isTauri ? getCurrentWebviewWindow() : null

    let maximized = $state(false)

    $effect(() => {
        if (!appWindow) {
            return
        }
        let disposed = false
        let unlisten: (() => void) | undefined
        const updateMaximized = async () => {
            try {
                if (!disposed) {
                    maximized = await appWindow.isMaximized()
                }
            } catch (error) {
                console.warn('Failed to read maximize state:', error)
            }
        }
        updateMaximized()
        appWindow
            .onResized(() => updateMaximized())
            .then((fn) => {
                if (disposed) {
                    fn()
                } else {
                    unlisten = fn
                }
            })
            .catch(() => undefined)
        return () => {
            disposed = true
            unlisten?.()
        }
    })

    onMount(() => {
        ensureDesktopTitleBarApplied().catch(() => undefined)
    })

    const contextLabel = $derived.by(() => {
        if ($settingsOpen) {
            return language.settings
        }
        const index = $selectedCharID
        const char = index >= 0 ? DBState.db.characters?.[index] : undefined
        if (char?.name) {
            return char.name
        }
        return 'RisuAI'
    })

    const toggleSidebar = () => {
        sideBarStore.update((open) => !open)
    }

    const toggleSettings = () => {
        settingsOpen.update((open) => !open)
    }

    const minimizeWindow = () => {
        appWindow?.minimize().catch((error) => console.warn('Minimize failed:', error))
    }

    const toggleMaximizeWindow = async () => {
        if (!appWindow) {
            return
        }
        try {
            await appWindow.toggleMaximize()
            maximized = await appWindow.isMaximized()
        } catch (error) {
            console.warn('Toggle maximize failed:', error)
        }
    }

    const closeWindow = () => {
        appWindow?.close().catch((error) => console.warn('Close failed:', error))
    }

    const iconButtonClass =
        'inline-flex h-8 min-h-8 w-8 min-w-8 items-center justify-center rounded-md text-textcolor transition-colors hover:bg-darkbutton focus-visible:outline-2 focus-visible:outline-selected'
</script>

<div
    class="relative z-40 flex h-10 min-h-10 w-full shrink-0 select-none items-stretch border-b border-borderc bg-bgcolor text-textcolor"
>
    <div
        class="flex items-center gap-0.5 pr-1 {isMac ? 'pl-[84px]' : 'pl-1.5'}"
        data-tauri-drag-region
    >
        <button
            type="button"
            class={iconButtonClass}
            title={language.titleBarToggleSidebar}
            aria-label={language.titleBarToggleSidebar}
            onclick={toggleSidebar}
        >
            <PanelLeftIcon size={16} />
        </button>
    </div>

    <div class="h-full min-w-1 flex-1" data-tauri-drag-region></div>

    <div
        class="flex h-full max-w-[45%] items-center justify-center"
        data-tauri-drag-region
    >
        <span class="truncate text-sm text-textcolor/90 max-[620px]:hidden">
            {contextLabel}
        </span>
    </div>

    <div class="h-full min-w-1 flex-1" data-tauri-drag-region></div>

    <div class="flex h-full items-center gap-0.5 pl-1 {isMac ? 'pr-2' : 'pr-0'}">
        {#if statusSnippet}
            {@render statusSnippet()}
        {/if}
        <button
            type="button"
            class="{iconButtonClass} mr-1"
            class:bg-selected={$settingsOpen}
            title={language.settings}
            aria-label={language.settings}
            onclick={toggleSettings}
        >
            <SettingsIcon size={16} />
        </button>
        {#if isWindowControlsPlatform}
            <button
                type="button"
                class="inline-flex h-10 min-h-10 w-11 min-w-11 items-center justify-center rounded-none text-textcolor transition-colors hover:bg-darkbutton focus-visible:outline-2 focus-visible:outline-selected"
                title={language.titleBarMinimize}
                aria-label={language.titleBarMinimize}
                onclick={minimizeWindow}
            >
                <MinusIcon size={16} />
            </button>
            <button
                type="button"
                class="inline-flex h-10 min-h-10 w-11 min-w-11 items-center justify-center rounded-none text-textcolor transition-colors hover:bg-darkbutton focus-visible:outline-2 focus-visible:outline-selected"
                title={maximized ? language.titleBarRestore : language.titleBarMaximize}
                aria-label={maximized ? language.titleBarRestore : language.titleBarMaximize}
                onclick={toggleMaximizeWindow}
            >
                {#if maximized}
                    <CopyIcon size={13} />
                {:else}
                    <SquareIcon size={13} />
                {/if}
            </button>
            <button
                type="button"
                class="inline-flex h-10 min-h-10 w-11 min-w-11 items-center justify-center rounded-none text-textcolor transition-colors hover:bg-draculared hover:text-white focus-visible:outline-2 focus-visible:outline-selected"
                title={language.titleBarClose}
                aria-label={language.titleBarClose}
                onclick={closeWindow}
            >
                <XIcon size={16} />
            </button>
        {/if}
    </div>
</div>
