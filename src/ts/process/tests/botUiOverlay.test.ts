import { describe, expect, test } from 'vitest';
import { get } from 'svelte/store';
import type { Chat } from 'src/ts/storage/database.svelte';
import { BotUiStateVersion, getBotUiStateValue, setBotUiStateValue } from '../botUiState.svelte';
import { sanitizeBotUiHtml, scopeBotUiStyles } from '../botUiOverlay';

function makeChat(): Chat {
    return {
        message: [],
        note: '',
        name: 'Chat 1',
        localLore: [],
    };
}

describe('bot UI state', () => {
    test('updates uiState and only bumps the version when the value changes', () => {
        const chat = makeChat();
        const initialVersion = get(BotUiStateVersion);

        expect(setBotUiStateValue(chat, 'money', '100')).toBe(true);
        expect(chat.uiState?.money).toBe(100);
        expect(getBotUiStateValue(chat, 'money')).toBe('100');
        expect(get(BotUiStateVersion)).toBe(initialVersion + 1);

        expect(setBotUiStateValue(chat, 'money', '100')).toBe(false);
        expect(get(BotUiStateVersion)).toBe(initialVersion + 1);

        expect(setBotUiStateValue(chat, 'money', '200')).toBe(true);
        expect(chat.uiState?.money).toBe(200);
        expect(get(BotUiStateVersion)).toBe(initialVersion + 2);
    });
});

describe('bot UI overlay HTML', () => {
    test('scopes style rules and matches Risu class name rewriting', () => {
        const scoped = scopeBotUiStyles(`
            <style>
                .panel, button.active { color: red; }
                @media (max-width: 600px) { .panel { color: blue; } }
                @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
            </style>
            <div class="panel"></div>
        `);

        expect(scoped).toContain('.bot-ui-overlay-scope .x-risu-panel');
        expect(scoped).toContain('.bot-ui-overlay-scope button.x-risu-active');
        expect(scoped).toContain('@media (max-width: 600px){.bot-ui-overlay-scope .x-risu-panel');
        expect(scoped).toContain('@keyframes fade{from{opacity:0;}to{opacity:1;}}');
    });

    test('removes executable HTML while preserving UI action attributes', () => {
        const sanitized = sanitizeBotUiHtml(`
            <script>alert(1)</script>
            <button onclick="alert(1)" risu-ui-action="upgrade" risu-ui-id="room">Upgrade</button>
        `);

        expect(sanitized).not.toContain('<script');
        expect(sanitized).not.toContain('onclick');
        expect(sanitized).toContain('risu-ui-action="upgrade"');
        expect(sanitized).toContain('risu-ui-id="room"');
    });
});
