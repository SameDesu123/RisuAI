<script lang="ts">
    import { AccessibilityIcon, ActivityIcon, PackageIcon, BotIcon, BoxIcon, CodeIcon, ContactIcon, LanguagesIcon, MonitorIcon, Sailboat, UserIcon, CircleXIcon, KeyboardIcon, SparkleIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import { additionalSettingsMenu, easyPanelStore, MobileGUI, SettingsMenuIndex, settingsOpen } from "src/ts/stores.svelte";
    import { DBState } from "src/ts/stores.svelte";
    import Lorepreset from "./lorepreset.svelte";
  import { isLite } from "src/ts/lite";
    import PluginDefinedIcon from "../Others/PluginDefinedIcon.svelte";

    let openLoreList = $state(false)
    function lazyComponent<T>(loader: () => Promise<T>) {
        let promise: Promise<T> | undefined
        return () => promise ??= loader()
    }

    const loadUserSettings = lazyComponent(() => import("./Pages/UserSettings.svelte").then(m => m.default))
    const loadBotSettings = lazyComponent(() => import("./Pages/BotSettings.svelte").then(m => m.default))
    const loadOtherBotSettings = lazyComponent(() => import("./Pages/OtherBotSettings.svelte").then(m => m.default))
    const loadDisplaySettings = lazyComponent(() => import("./Pages/DisplaySettings.svelte").then(m => m.default))
    const loadPluginSettings = lazyComponent(() => import("./Pages/PluginSettings.svelte").then(m => m.default))
    const loadFilesSettings = lazyComponent(() => import("./Pages/FilesSettings.svelte").then(m => m.default))
    const loadAdvancedSettings = lazyComponent(() => import("./Pages/AdvancedSettings.svelte").then(m => m.default))
    const loadCommunities = lazyComponent(() => import("./Pages/Communities.svelte").then(m => m.default))
    const loadGlobalLoreBookSettings = lazyComponent(() => import("./Pages/GlobalLoreBookSettings.svelte").then(m => m.default))
    const loadGlobalRegex = lazyComponent(() => import("./Pages/GlobalRegex.svelte").then(m => m.default))
    const loadLanguageSettings = lazyComponent(() => import("./Pages/LanguageSettings.svelte").then(m => m.default))
    const loadAccessibilitySettings = lazyComponent(() => import("./Pages/AccessibilitySettings.svelte").then(m => m.default))
    const loadPersonaSettings = lazyComponent(() => import("./Pages/PersonaSettings.svelte").then(m => m.default))
    const loadPromptSettings = lazyComponent(() => import("./Pages/PromptSettings.svelte").then(m => m.default))
    const loadModuleSettings = lazyComponent(() => import("./Pages/Module/ModuleSettings.svelte").then(m => m.default))
    const loadHotkeySettings = lazyComponent(() => import("./Pages/HotkeySettings.svelte").then(m => m.default))
    const loadThanksPage = lazyComponent(() => import("./Pages/ThanksPage.svelte").then(m => m.default))
    if(window.innerWidth >= 900 && $SettingsMenuIndex === -1 && !$MobileGUI){
        $SettingsMenuIndex = 1
    }

</script>
<div class="h-full w-full flex justify-center rs-setting-cont" class:bg-bgcolor={$MobileGUI} class:setting-bg={!$MobileGUI}>
    <div class="h-full max-w-(--breakpoint-lg) w-full flex relative rs-setting-cont-2">
        {#if (window.innerWidth >= 700 && !$MobileGUI) || $SettingsMenuIndex === -1}
            <div class="flex h-full flex-col p-4 pt-8 gap-2 overflow-y-auto relative rs-setting-cont-3 shrink-0"
                class:w-full={window.innerWidth < 700 || $MobileGUI}
                class:bg-darkbg={!$MobileGUI} class:bg-bgcolor={$MobileGUI}
            >
                
                {#if !$isLite}
                    <button class="flex gap-2 items-center hover:text-textcolor"
                        class:text-textcolor={$SettingsMenuIndex === 1 || $SettingsMenuIndex === 13}
                        class:text-textcolor2={$SettingsMenuIndex !== 1 && $SettingsMenuIndex !== 13}
                        onclick={() => {
                            $SettingsMenuIndex = 1
                            
                    }}>
                        <BotIcon />
                        <span>{language.chatBot}</span>
                    </button>
                    <button class="flex gap-2 items-center hover:text-textcolor"
                        class:text-textcolor={$SettingsMenuIndex === 12}
                        class:text-textcolor2={$SettingsMenuIndex !== 12}
                        onclick={() => {
                            $SettingsMenuIndex = 12
                    }}>
                        <ContactIcon />
                        <span>{language.persona}</span>
                    </button>
                    <button class="flex gap-2 items-center hover:text-textcolor"
                        class:text-textcolor={$SettingsMenuIndex === 2}
                        class:text-textcolor2={$SettingsMenuIndex !== 2}
                        onclick={() => {
                            $SettingsMenuIndex = 2
                    }}>
                        <Sailboat />
                        <span>{language.otherBots}</span>
                    </button>
                    <button class="flex gap-2 items-center hover:text-textcolor"
                        class:text-textcolor={$SettingsMenuIndex === 3}
                        class:text-textcolor2={$SettingsMenuIndex !== 3}
                        onclick={() => {
                            $SettingsMenuIndex = 3
                    }}>
                        <MonitorIcon />
                        <span>{language.display}</span>
                    </button>
                {/if}
                <button class="flex gap-2 items-center hover:text-textcolor"
                    class:text-textcolor={$SettingsMenuIndex === 10}
                    class:text-textcolor2={$SettingsMenuIndex !== 10}
                    onclick={() => {
                        $SettingsMenuIndex = 10
                }}>
                    <LanguagesIcon />
                    <span>{language.language}</span>
                </button>
                {#if !$isLite}
                    <button class="flex gap-2 items-center hover:text-textcolor"
                        class:text-textcolor={$SettingsMenuIndex === 11}
                        class:text-textcolor2={$SettingsMenuIndex !== 11}
                        onclick={() => {
                            $SettingsMenuIndex = 11
                    }}>
                        <AccessibilityIcon />
                        <span>{language.accessibility}</span>
                    </button>
                    <button class="flex gap-2 items-center hover:text-textcolor"
                        class:text-textcolor={$SettingsMenuIndex === 14}
                        class:text-textcolor2={$SettingsMenuIndex !== 14}
                        onclick={() => {
                            $SettingsMenuIndex = 14
                    }}>
                        <PackageIcon />
                        <span>{language.modules}</span>
                    </button>
                    <button class="flex gap-2 items-center hover:text-textcolor"
                        class:text-textcolor={$SettingsMenuIndex === 4}
                        class:text-textcolor2={$SettingsMenuIndex !== 4}
                        onclick={() => {
                        $SettingsMenuIndex = 4
                    }}>
                        <CodeIcon />
                        <span>{language.plugin}</span>
                    </button>
                {/if}
                <button class="flex gap-2 items-center hover:text-textcolor"
                    class:text-textcolor={$SettingsMenuIndex === 0}
                    class:text-textcolor2={$SettingsMenuIndex !== 0}
                    onclick={() => {
                        $SettingsMenuIndex = 0
                }}>
                    <UserIcon />
                    <span>{language.account} & {language.files}</span>
                </button>
                <button class="flex gap-2 items-center hover:text-textcolor"
                        class:text-textcolor={$SettingsMenuIndex === 15}
                        class:text-textcolor2={$SettingsMenuIndex !== 15}
                        onclick={() => {
                        $SettingsMenuIndex = 15
                    }}>
                        <KeyboardIcon />
                        <span>{language.hotkey}</span>
                    </button>
                {#if !$isLite}
                    <button class="flex gap-2 items-center hover:text-textcolor"
                        class:text-textcolor={$SettingsMenuIndex === 6}
                        class:text-textcolor2={$SettingsMenuIndex !== 6}
                        onclick={() => {
                        $SettingsMenuIndex = 6
                    }}>
                        <ActivityIcon />
                        <span>{language.advancedSettings}</span>
                    </button>
                    <button class="flex gap-2 items-center hover:text-textcolor"
                        class:text-textcolor={$SettingsMenuIndex === 77}
                        class:text-textcolor2={$SettingsMenuIndex !== 77}
                        onclick={() => {
                        $SettingsMenuIndex = 77
                    }}>
                        <BoxIcon />
                        <span>{language.supporterThanks}</span>
                    </button>
                    {#each additionalSettingsMenu as menu}
                        <button class="flex gap-2 items-center hover:text-textcolor text-textcolor2"
                            onclick={() => {
                                menu.callback()
                        }}>
                            <PluginDefinedIcon ico={menu} />
                            <span>{menu.name}</span>
                        </button>
                    {/each}

                    {#if DBState.db.enableRisuaiProTools}
                        <button class="flex gap-2 items-center hover:text-textcolor"
                            class:text-textcolor={$SettingsMenuIndex === 16}
                            class:text-textcolor2={$SettingsMenuIndex !== 16}
                            onclick={() => {
                            easyPanelStore.open = true
                        }}>
                            <!-- From Lucide Icons, licensed under MIT/ISC License, modified to fit the design. see license from bundled lucide icons. -->
                            <svg width={24} height={24}>
                                <defs>
                                    <linearGradient id={`grad1`} x1='0' y1='0' x2='1' y2='0'>
                                    <stop offset='0%' style="stop-color:#587bff"/>
                                    <stop offset='100%' style="stop-color:#00a1ad"/>
                                    </linearGradient>
                                </defs>
                                    <SparkleIcon color="url(#grad1)" />
                            </svg>
                            <span>{language.easyPanel}</span>
                        </button>
                    {/if}
                {/if}
                {#if window.innerWidth < 700 && !$MobileGUI}
                    <button class="absolute top-2 right-2 hover:text-green-500 text-textcolor" onclick={() => {
                        settingsOpen.set(false)
                    }}> <CircleXIcon size={DBState.db.settingsCloseButtonSize} /> </button>
                {/if}
            </div>
        {/if}
        {#if (window.innerWidth >= 700 && !$MobileGUI) || $SettingsMenuIndex !== -1}
            {#key $SettingsMenuIndex}
                <div class="grow py-6 px-4 bg-bgcolor flex flex-col text-textcolor overflow-y-auto relative rs-setting-cont-4 min-w-0">
                    {#if $SettingsMenuIndex === 0}
                        {#await loadUserSettings() then UserSettings}
                            <UserSettings />
                        {/await}
                    {:else if $SettingsMenuIndex === 1}
                        {#await loadBotSettings() then BotSettings}
                            <BotSettings goPromptTemplate={() => {
                                $SettingsMenuIndex = 13
                            }} />
                        {/await}
                    {:else if $SettingsMenuIndex === 2}
                        {#await loadOtherBotSettings() then OtherBotSettings}
                            <OtherBotSettings />
                        {/await}
                    {:else if $SettingsMenuIndex === 3}
                        {#await loadDisplaySettings() then DisplaySettings}
                            <DisplaySettings />
                        {/await}
                    {:else if $SettingsMenuIndex === 4}
                        {#await loadPluginSettings() then PluginSettings}
                            <PluginSettings />
                        {/await}
                    {:else if $SettingsMenuIndex === 5}
                        {#await loadFilesSettings() then FilesSettings}
                            <FilesSettings />
                        {/await}
                    {:else if $SettingsMenuIndex === 6}
                        {#await loadAdvancedSettings() then AdvancedSettings}
                            <AdvancedSettings />
                        {/await}
                    {:else if $SettingsMenuIndex === 7}
                        {#await loadCommunities() then Communities}
                            <Communities />
                        {/await}
                    {:else if $SettingsMenuIndex === 8}
                        {#await loadGlobalLoreBookSettings() then GlobalLoreBookSettings}
                            <GlobalLoreBookSettings bind:openLoreList />
                        {/await}
                    {:else if $SettingsMenuIndex === 9}
                        {#await loadGlobalRegex() then GlobalRegex}
                            <GlobalRegex />
                        {/await}
                    {:else if $SettingsMenuIndex === 10}
                        {#await loadLanguageSettings() then LanguageSettings}
                            <LanguageSettings />
                        {/await}
                    {:else if $SettingsMenuIndex === 11}
                        {#await loadAccessibilitySettings() then AccessibilitySettings}
                            <AccessibilitySettings />
                        {/await}
                    {:else if $SettingsMenuIndex === 12}
                        {#await loadPersonaSettings() then PersonaSettings}
                            <PersonaSettings />
                        {/await}
                    {:else if $SettingsMenuIndex === 14}
                        {#await loadModuleSettings() then ModuleSettings}
                            <ModuleSettings />
                        {/await}
                    {:else if $SettingsMenuIndex === 13}
                        {#await loadPromptSettings() then PromptSettings}
                            <PromptSettings onGoBack={() => {
                                $SettingsMenuIndex = 1
                            }}/>
                        {/await}
                    {:else if $SettingsMenuIndex === 15 && window.innerWidth >= 768}
                        {#await loadHotkeySettings() then HotkeySettings}
                            <HotkeySettings />
                        {/await}
                    {:else if $SettingsMenuIndex === 77}
                        {#await loadThanksPage() then ThanksPage}
                            <ThanksPage />
                        {/await}
                    {/if}
            </div>
            {/key}
            {#if !$MobileGUI}
                <button class="absolute top-2 right-2 hover:text-green-500 text-textcolor" onclick={() => {
                    if(window.innerWidth >= 700){
                        settingsOpen.set(false)
                    }
                    else{
                        $SettingsMenuIndex = -1
                    }
                }}>
                    <CircleXIcon size={DBState.db.settingsCloseButtonSize} />
                </button>
            {/if}
        {/if}
    </div>
</div>
{#if openLoreList}
    <Lorepreset close={() => {openLoreList = false}} />
{/if}
<style>
    .setting-bg{
        background: linear-gradient(to right, var(--risu-theme-darkbg) 50%, var(--risu-theme-bgcolor) 50%);

    }
</style>
