import { describe, expect, it } from "vitest";
import type { Database } from "./database.svelte";
import type { DatabaseBlockStorageAdapter } from "./databaseBlockFormat";
import {
    hydrateDatabaseBlockChat,
    hydrateDatabaseBlockDatabase,
    isDatabaseBlockChatStub,
    loadDatabaseBlockDatabase,
} from "./databaseBlockReader";
import { createDatabaseBlockManifest } from "./databaseBlockWriter";

class MemoryBlockStorage implements DatabaseBlockStorageAdapter {
    values = new Map<string, Uint8Array>();
    reads: string[] = [];

    async getItem(key: string) {
        this.reads.push(key);
        return this.values.get(key) ?? null;
    }

    async setItem(key: string, value: Uint8Array) {
        this.values.set(key, value);
    }
}

function createDatabase(): Database {
    return {
        characters: [{
            type: "character",
            chaId: "char-1",
            name: "Character",
            firstMessage: "Hello",
            desc: "Description",
            notes: "",
            chats: [{
                id: "chat-1",
                name: "Chat 1",
                note: "note",
                localLore: [],
                message: [{ role: "char", data: "hello" }],
            }],
            chatFolders: [],
            chatPage: 0,
            viewScreen: "none",
            bias: [],
            emotionImages: [],
            globalLore: [],
            sdData: [],
            customscript: [],
            triggerscript: [],
            utilityBot: false,
            exampleMessage: "",
            creatorNotes: "",
            systemPrompt: "",
            postHistoryInstructions: "",
            alternateGreetings: [],
            tags: [],
            creator: "",
            characterVersion: "",
            personality: "",
            scenario: "",
            firstMsgIndex: -1,
            replaceGlobalNote: "",
            additionalText: "",
        }],
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        language: "en",
    } as unknown as Database;
}

describe("databaseBlockReader", () => {
    it("loads character metadata without decoding chat bodies", async () => {
        const storage = new MemoryBlockStorage();
        const manifest = await createDatabaseBlockManifest(createDatabase(), storage);
        storage.reads = [];
        const loaded = await loadDatabaseBlockDatabase(manifest, storage);

        expect(loaded.characters[0].name).toBe("Character");
        expect(isDatabaseBlockChatStub(loaded.characters[0].chats[0])).toBe(true);
        expect(loaded.characters[0].chats[0].message).toEqual([]);
        expect(storage.reads.some((key) => key.includes("/chats/"))).toBe(false);

        await hydrateDatabaseBlockChat(loaded, storage, 0, 0);
        expect(storage.reads.some((key) => key.includes("/chats/"))).toBe(true);
        expect(isDatabaseBlockChatStub(loaded.characters[0].chats[0])).toBe(false);
        expect(loaded.characters[0].chats[0].message[0].data).toBe("hello");
    });

    it("materializes every lazy chat for legacy serialization", async () => {
        const storage = new MemoryBlockStorage();
        const manifest = await createDatabaseBlockManifest(createDatabase(), storage);
        const loaded = await loadDatabaseBlockDatabase(manifest, storage);
        const hydrated = await hydrateDatabaseBlockDatabase(loaded, storage);

        expect(isDatabaseBlockChatStub(hydrated.characters[0].chats[0])).toBe(false);
        expect(hydrated.characters[0].chats[0].message[0].data).toBe("hello");
    });

    it("rebuilds a manifest from lazy stubs without replacing chat payloads", async () => {
        const storage = new MemoryBlockStorage();
        const first = await createDatabaseBlockManifest(createDatabase(), storage);
        const loaded = await loadDatabaseBlockDatabase(first, storage);
        loaded.characters[0].chats[0].note = "renamed";

        const recovered = await createDatabaseBlockManifest(loaded, storage, undefined, {
            chat: [["char-1", "chat-1"]],
        });
        const reloaded = await loadDatabaseBlockDatabase(recovered, storage);
        await hydrateDatabaseBlockChat(reloaded, storage, 0, 0);

        expect(recovered.characters.chatRefs["char-1"].refs["chat-1"].hash)
            .toBe(first.characters.chatRefs["char-1"].refs["chat-1"].hash);
        expect(reloaded.characters[0].chats[0].note).toBe("renamed");
        expect(reloaded.characters[0].chats[0].message[0].data).toBe("hello");
    });

    it("fails strictly when a referenced payload is missing", async () => {
        const storage = new MemoryBlockStorage();
        const manifest = await createDatabaseBlockManifest(createDatabase(), storage);
        const loaded = await loadDatabaseBlockDatabase(manifest, storage);
        const chatRef = manifest.characters.chatRefs["char-1"].refs["chat-1"];

        storage.values.delete(chatRef.key);
        await expect(hydrateDatabaseBlockChat(loaded, storage, 0, 0))
            .rejects.toThrow("Missing database block");
    });

    it("fails strictly when a required component reference is missing", async () => {
        const storage = new MemoryBlockStorage();
        const manifest = await createDatabaseBlockManifest(createDatabase(), storage);
        delete manifest.components.plugins;

        await expect(loadDatabaseBlockDatabase(manifest, storage))
            .rejects.toThrow("Missing database component reference: plugins");
    });
});
