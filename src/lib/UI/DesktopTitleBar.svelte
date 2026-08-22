<script lang="ts">
    import { onMount, type Snippet } from 'svelte'
    import {
        PanelLeftIcon,
        HomeIcon,
        MessageCircleIcon,
        ContactIcon,
        LayoutGridIcon,
        GlobeIcon,
        ShellIcon,
        Settings as SettingsIcon,
        MinusIcon,
        SquareIcon,
        CopyIcon,
        XIcon,
    } from '@lucide/svelte'
    import { language } from 'src/lang'
    import {
        DBState,
        additionalHamburgerMenu,
        OpenRealmStore,
        PlaygroundStore,
        selectedCharID,
        SettingsMenuIndex,
        settingsOpen,
        sideBarStore,
    } from 'src/ts/stores.svelte'
    import PluginDefinedIcon from 'src/lib/Others/PluginDefinedIcon.svelte'
    import {
        ensureDesktopTitleBarApplied,
        getTauriDesktopPlatform,
    } from 'src/ts/gui/windowChrome.svelte'
    import { isTauri } from 'src/ts/platform'
    import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

    interface Props {
        /** Reserved seat for transient status indicators (save/connection/update). */
        statusSnippet?: Snippet
        gridOpen?: boolean
    }

    let { statusSnippet, gridOpen = $bindable(false) }: Props = $props()

    const platform = getTauriDesktopPlatform()
    const isMac = platform === 'macos'
    const isWindowControlsPlatform = platform === 'windows' || platform === 'linux'

    const appWindow = isTauri ? getCurrentWebviewWindow() : null

    let maximized = $state(false)
    let lastCharacterIndex = $state(-1)

    $effect(() => {
        const index = $selectedCharID
        if (index >= 0 && DBState.db.characters?.[index]?.chaId !== '§playground') {
            lastCharacterIndex = index
        }
    })

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

    const homeActive = $derived(
        !gridOpen && !$settingsOpen && !$OpenRealmStore && $PlaygroundStore === 0 && $selectedCharID < 0
    )
    const normalActive = $derived(
        !gridOpen && !$settingsOpen && !$OpenRealmStore && $PlaygroundStore === 0 && $selectedCharID >= 0
    )

    const toggleSidebar = () => {
        sideBarStore.update((open) => !open)
    }

    const openHome = () => {
        gridOpen = false
        settingsOpen.set(false)
        selectedCharID.set(-1)
        PlaygroundStore.set(0)
        OpenRealmStore.set(false)
    }

    const openNormal = () => {
        gridOpen = false
        settingsOpen.set(false)
        PlaygroundStore.set(0)
        OpenRealmStore.set(false)
        if ($selectedCharID < 0 && DBState.db.characters?.[lastCharacterIndex]) {
            selectedCharID.set(lastCharacterIndex)
        }
    }

    const openPersona = () => {
        gridOpen = false
        SettingsMenuIndex.set(12)
        settingsOpen.set(true)
    }

    const openCharacterGrid = () => {
        settingsOpen.set(false)
        PlaygroundStore.set(0)
        OpenRealmStore.set(false)
        gridOpen = true
    }

    const openRealm = () => {
        gridOpen = false
        settingsOpen.set(false)
        selectedCharID.set(-1)
        PlaygroundStore.set(0)
        OpenRealmStore.set(true)
    }

    const openPlayground = () => {
        gridOpen = false
        settingsOpen.set(false)
        selectedCharID.set(-1)
        OpenRealmStore.set(false)
        PlaygroundStore.set(1)
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
        'inline-flex h-9 min-h-9 w-9 min-w-9 items-center justify-center rounded-lg text-textcolor transition-colors hover:bg-darkbutton focus-visible:outline-2 focus-visible:outline-selected'
    const segmentButtonClass =
        'inline-flex h-9 min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-textcolor transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-selected'

    const quickNavigation = [
        { id: 'normal', icon: MessageCircleIcon, label: () => language.normal, active: () => normalActive, open: openNormal },
        { id: 'persona', icon: ContactIcon, label: () => language.persona, active: () => $settingsOpen && $SettingsMenuIndex === 12, open: openPersona },
        { id: 'characters', icon: LayoutGridIcon, label: () => language.character, active: () => gridOpen, open: openCharacterGrid },
        { id: 'realm', icon: GlobeIcon, label: () => language.hub, active: () => !gridOpen && !$settingsOpen && $OpenRealmStore, open: openRealm },
        { id: 'playground', icon: ShellIcon, label: () => language.playground.playground, active: () => !gridOpen && !$settingsOpen && $PlaygroundStore !== 0, open: openPlayground },
    ]
</script>

<div
    class="relative z-40 flex h-[52px] min-h-[52px] w-full shrink-0 select-none items-stretch border-b border-borderc bg-bgcolor text-textcolor"
>
    <div
        class="flex items-center gap-1 pr-1.5 {isMac ? 'pl-[84px]' : 'pl-2'}"
        data-tauri-drag-region
    >
        <button
            type="button"
            class={iconButtonClass}
            title={language.titleBarToggleSidebar}
            aria-label={language.titleBarToggleSidebar}
            onclick={toggleSidebar}
        >
            <PanelLeftIcon size={18} />
        </button>
        <button
            type="button"
            class={iconButtonClass}
            class:bg-selected={homeActive}
            title={language.home}
            aria-label={language.home}
            onclick={openHome}
        >
            <HomeIcon size={18} />
        </button>
    </div>

    <div
        class="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-xl border border-textcolor/10 bg-darkbg p-1 shadow-sm max-[560px]:hidden"
    >
        {#each quickNavigation as item (item.id)}
            {@const Icon = item.icon}
            <button
                type="button"
                class="{segmentButtonClass} {item.active()
                    ? 'bg-selected shadow-sm ring-1 ring-textcolor/10'
                    : 'text-textcolor/70 hover:bg-darkbutton hover:text-textcolor'}"
                title={item.label()}
                aria-label={item.label()}
                aria-pressed={item.active()}
                onclick={item.open}
            >
                <Icon size={16} />
                <span class="max-[900px]:hidden">{item.label()}</span>
            </button>
        {/each}
        {#each additionalHamburgerMenu as menu (menu.id)}
            <button
                type="button"
                class="{segmentButtonClass} px-2.5 text-textcolor/70 hover:bg-darkbutton hover:text-textcolor"
                title={menu.name}
                aria-label={menu.name}
                onclick={() => {
                    gridOpen = false
                    settingsOpen.set(false)
                    menu.callback()
                }}
            >
                <PluginDefinedIcon ico={menu} />
            </button>
        {/each}
    </div>

    <div class="h-full min-w-1 flex-1" data-tauri-drag-region></div>

    <div class="flex h-full items-center gap-1 pl-1.5 {isMac ? 'pr-2' : 'pr-0'}">
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
            <SettingsIcon size={18} />
        </button>
        {#if isWindowControlsPlatform}
            <button
                type="button"
                class="inline-flex h-full w-12 min-w-12 items-center justify-center rounded-none text-textcolor transition-colors hover:bg-darkbutton focus-visible:outline-2 focus-visible:outline-selected"
                title={language.titleBarMinimize}
                aria-label={language.titleBarMinimize}
                onclick={minimizeWindow}
            >
                <MinusIcon size={18} />
            </button>
            <button
                type="button"
                class="inline-flex h-full w-12 min-w-12 items-center justify-center rounded-none text-textcolor transition-colors hover:bg-darkbutton focus-visible:outline-2 focus-visible:outline-selected"
                title={maximized ? language.titleBarRestore : language.titleBarMaximize}
                aria-label={maximized ? language.titleBarRestore : language.titleBarMaximize}
                onclick={toggleMaximizeWindow}
            >
                {#if maximized}
                    <CopyIcon size={15} />
                {:else}
                    <SquareIcon size={15} />
                {/if}
            </button>
            <button
                type="button"
                class="inline-flex h-full w-12 min-w-12 items-center justify-center rounded-none text-textcolor transition-colors hover:bg-draculared hover:text-white focus-visible:outline-2 focus-visible:outline-selected"
                title={language.titleBarClose}
                aria-label={language.titleBarClose}
                onclick={closeWindow}
            >
                <XIcon size={18} />
            </button>
        {/if}
    </div>
</div>
