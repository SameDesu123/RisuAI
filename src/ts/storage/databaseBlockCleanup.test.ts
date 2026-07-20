import { describe, expect, it } from "vitest";
import type { Database } from "./database.svelte";
import { cleanupDatabaseBlockGenerations } from "./databaseBlockCleanup";
import type { DatabaseBlockStorageAdapter } from "./databaseBlockFormat";
import { saveDatabaseBlockDatabase } from "./databaseBlockStorage";

class MemoryBlockStorage implements DatabaseBlockStorageAdapter {
    values = new Map<string, Uint8Array>();

    async getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    async setItem(key: string, value: Uint8Array) {
        this.values.set(key, value);
    }

    async keys() {
        return [...this.values.keys()];
    }

    async removeItem(key: string) {
        this.values.delete(key);
    }
}

function createDatabase(message: string): Database {
    return {
        characters: [{
            chaId: "char-1",
            chats: [{
                id: "chat-1",
                name: "Chat",
                note: "",
                localLore: [],
                message: [{ role: "char", data: message }],
            }],
            name: "Character",
        }],
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
    } as unknown as Database;
}

describe("databaseBlockCleanup", () => {
    it("retains blocks referenced by the primary and retained backup manifests", async () => {
        const storage = new MemoryBlockStorage();
        const first = await saveDatabaseBlockDatabase(createDatabase("old"), storage, undefined, null);
        const secondDb = createDatabase("new");
        const second = await saveDatabaseBlockDatabase(secondDb, storage, {
            chat: [["char-1", "chat-1"]],
        }, first.manifest);
        const orphan = "database/blocks/v2/orphan.bin";
        storage.values.set(orphan, new Uint8Array([1]));

        const removed = await cleanupDatabaseBlockGenerations(storage, [second.manifest, first.manifest]);

        expect(removed).toEqual([orphan]);
        expect(storage.values.has(first.manifest.characters.chatRefs["char-1"].refs["chat-1"].key)).toBe(true);
        expect(storage.values.has(second.manifest.characters.chatRefs["char-1"].refs["chat-1"].key)).toBe(true);

        await cleanupDatabaseBlockGenerations(storage, [second.manifest]);
        expect(storage.values.has(first.manifest.characters.chatRefs["char-1"].refs["chat-1"].key)).toBe(false);
        expect(storage.values.has(second.manifest.characters.chatRefs["char-1"].refs["chat-1"].key)).toBe(true);
    });
});
