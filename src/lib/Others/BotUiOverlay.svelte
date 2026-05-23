<script lang="ts">
    import { selectedCharID, DBState } from "src/ts/stores.svelte";
    import { BotUiStateVersion } from "src/ts/process/botUiState.svelte";
    import { dispatchBotUiLuaEvent, renderBotUiLua } from "src/ts/process/scriptings";
    import { sanitizeBotUiHtml } from "src/ts/process/botUiOverlay";
    import type { Chat, character } from "src/ts/storage/database.svelte";

    let html = $state('');
    let lastRawHtml = '';
    let renderToken = 0;

    const selectedChar = $derived(DBState.db?.characters?.[$selectedCharID]);
    const selectedChat = $derived(
        selectedChar?.type === 'character'
            ? selectedChar.chats?.[selectedChar.chatPage]
            : null
    );
    const selectedChatKey = $derived(
        selectedChar?.type === 'character'
            ? `${selectedChar.chaId}:${selectedChar.chatPage}:${selectedChat?.id ?? ''}`
            : ''
    );
    const botUiLua = $derived(selectedChar?.type === 'character' ? selectedChar.botUiLua ?? '' : '');

    async function renderOverlay(char: character, chat: Chat): Promise<void> {
        const token = ++renderToken;
        const rawHtml = await renderBotUiLua(char, chat);
        if(token !== renderToken){
            return;
        }
        if(rawHtml === lastRawHtml){
            return;
        }
        lastRawHtml = rawHtml;
        html = rawHtml ? sanitizeBotUiHtml(rawHtml) : '';
    }

    $effect(() => {
        const version = $BotUiStateVersion;
        void version;
        void selectedChatKey;

        if(!selectedChar || selectedChar.type !== 'character' || !selectedChat || !botUiLua.trim()){
            renderToken++;
            html = '';
            lastRawHtml = '';
            return;
        }

        void renderOverlay(selectedChar, selectedChat);
    });

    function handleClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        const actionElement = target?.closest('[risu-ui-action]') as HTMLElement | null;
        if(!actionElement || !selectedChar || selectedChar.type !== 'character' || !selectedChat){
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        void dispatchBotUiLuaEvent(selectedChar, selectedChat, {
            action: actionElement.getAttribute('risu-ui-action') ?? '',
            id: actionElement.getAttribute('risu-ui-id') ?? '',
            value: actionElement.getAttribute('risu-ui-value') ?? '',
        });
    }
</script>

{#if html}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pointer-events-none fixed inset-0 z-40 max-w-full overflow-hidden">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="bot-ui-overlay-scope pointer-events-auto h-full w-full" onclick={handleClick}>
            {@html html}
        </div>
    </div>
{/if}
