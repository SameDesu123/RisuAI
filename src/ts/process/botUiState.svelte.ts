import { writable } from "svelte/store";
import type { Chat } from "../storage/database.svelte";

export const BotUiStateVersion = writable(0);

function stringifyStateValue(value: unknown): string {
    try {
        return JSON.stringify(value) ?? 'undefined';
    } catch (error) {
        return JSON.stringify(String(value));
    }
}

export function getBotUiStateValue(chat: Chat, key: string): string {
    const value = chat.uiState?.[key];
    if(value === undefined){
        return 'null';
    }
    return stringifyStateValue(value);
}

export function setBotUiStateValue(chat: Chat, key: string, encodedValue: string): boolean {
    let value: unknown;
    try {
        value = JSON.parse(encodedValue);
    } catch (error) {
        value = encodedValue;
    }

    chat.uiState ??= {};
    if(stringifyStateValue(chat.uiState[key]) === stringifyStateValue(value)){
        return false;
    }

    chat.uiState[key] = value;
    BotUiStateVersion.update((version) => version + 1);
    return true;
}

export function getBotUiStateSnapshot(chat: Chat): Record<string, unknown> {
    return { ...(chat.uiState ?? {}) };
}
