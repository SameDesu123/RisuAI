<script lang="ts">
    import { MobileGUIStack, MobileSideBar, selectedCharID } from "src/ts/stores.svelte";
    import RealmMain from "../UI/Realm/RealmMain.svelte";
    import MobileCharacters from "./MobileCharacters.svelte";
    import ChatScreen from "../ChatScreens/ChatScreen.svelte";
    import { WrenchIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import SideChatList from "../SideBars/SideChatList.svelte";
    import { isLite } from "src/ts/lite";
    
    import { DBState } from 'src/ts/stores.svelte';
    function lazyComponent<T>(loader: () => Promise<T>) {
        let promise: Promise<T> | undefined
        return () => promise ??= loader()
    }

    const loadSettings = lazyComponent(() => import("../Setting/Settings.svelte").then(m => m.default))
    const loadCharConfig = lazyComponent(() => import("../SideBars/CharConfig.svelte").then(m => m.default))
    const loadDevTool = lazyComponent(() => import("../SideBars/DevTool.svelte").then(m => m.default))
</script>

{#if $MobileSideBar > 0 && !$isLite}
<div class="w-full px-2 py-1 text-textcolor2 border-b border-b-darkborderc bg-darkbg flex justify-start items-center gap-2">
    <button class="flex-1 border-r border-r-darkborderc" class:text-textcolor={$MobileSideBar === 1} onclick={() => {
        $MobileSideBar = 1
    }}>
        {language.Chat}
    </button>
    <button class="flex-1 border-r border-r-darkborderc" class:text-textcolor={$MobileSideBar === 2} onclick={() => {
        $MobileSideBar = 2
    }}>
        {language.character}
    </button>
    <button class:text-textcolor={$MobileSideBar === 3} onclick={() => {
        $MobileSideBar = 3
    }}>
        <WrenchIcon size={18} />
    </button>
</div>
{/if}
<div class="w-full flex-1 overflow-y-auto bg-bgcolor relative">
    {#if $MobileSideBar > 0}
        <div class="w-full flex flex-col p-2 mt-2 h-full">
            {#if $MobileSideBar === 1}
                <SideChatList bind:chara={DBState.db.characters[$selectedCharID]} />
            {:else if $MobileSideBar === 2}
                {#await loadCharConfig() then CharConfig}
                    <CharConfig />
                {/await}
            {:else if $MobileSideBar === 3}
                {#await loadDevTool() then DevTool}
                    <DevTool />
                {/await}
            {/if}
        </div>
    {:else if $selectedCharID !== -1}
        <ChatScreen />
    {:else if $MobileGUIStack === 0}
        <RealmMain />
    {:else if $MobileGUIStack === 1}
        <MobileCharacters />
    {:else if $MobileGUIStack === 2}
        {#await loadSettings() then Settings}
            <Settings />
        {/await}
    {/if}
</div>
