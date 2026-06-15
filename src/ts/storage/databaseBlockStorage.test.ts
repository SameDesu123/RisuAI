import { describe, expect, it } from "vitest";
import type { Database } from "./database.svelte";
import {
    hydrateDatabaseBlockChat,
    isDatabaseBlockChatStub,
    isDatabaseBlockManifest,
    loadDatabaseBlockDatabase,
    saveDatabaseBlockDatabase,
    type DatabaseBlockStorageAdapter,
} from "./databaseBlockStorage";

class MemoryBlockStorage implements DatabaseBlockStorageAdapter {
    values = new Map<string, Uint8Array>();

    async getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    async setItem(key: string, value: Uint8Array) {
        this.values.set(key, value);
    }

    async keys() {
        return Array.from(this.values.keys());
    }
}

function makeDb(): Database {
    return {
        databaseBlockStorage: true,
        characters: [{
            type: "character",
            chaId: "char-1",
            name: "Character",
            image: "assets/char.png",
            firstMessage: "Hello",
            desc: "Description",
            notes: "",
            chats: [{
                id: "chat-1",
                name: "Chat 1",
                note: "note",
                localLore: [],
                message: [
                    { role: "user", data: "hello", chatId: "m1" },
                    { role: "char", data: "hi", chatId: "m2" },
                ],
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
        botPresets: [{ name: "Default" }],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        language: "en",
        formatversion: 1,
    } as unknown as Database;
}

describe("databaseBlockStorage", () => {
    it("stores database as manifest and lazily hydrates chat blocks", async () => {
        const storage = new MemoryBlockStorage();
        const db = makeDb();

        const manifestBytes = await saveDatabaseBlockDatabase(db, storage);
        expect(isDatabaseBlockManifest(manifestBytes)).toBe(true);
        expect(Array.from(storage.values.keys()).some((key) => key.includes("/chats/"))).toBe(true);

        const loaded = await loadDatabaseBlockDatabase(manifestBytes, storage);
        expect(loaded.databaseBlockStorage).toBe(true);
        expect(loaded.characters[0].name).toBe("Character");
        expect(isDatabaseBlockChatStub(loaded.characters[0].chats[0])).toBe(true);

        await hydrateDatabaseBlockChat(loaded, storage, 0, 0);
        expect(isDatabaseBlockChatStub(loaded.characters[0].chats[0])).toBe(false);
        expect(loaded.characters[0].chats[0].message[1].data).toBe("hi");
    });

    it("reuses unchanged chat blocks on incremental saves", async () => {
        const storage = new MemoryBlockStorage();
        const db = makeDb();
        const firstManifest = await saveDatabaseBlockDatabase(db, storage);
        const loaded = await loadDatabaseBlockDatabase(firstManifest, storage);
        const firstChatRef = loaded.characters[0].chats[0].databaseBlockStorage;

        loaded.characters[0].name = "Renamed";
        const secondManifest = await saveDatabaseBlockDatabase(loaded, storage, {
            character: ["char-1"],
            chat: [],
        });
        const reloaded = await loadDatabaseBlockDatabase(secondManifest, storage);

        expect(reloaded.characters[0].name).toBe("Renamed");
        expect(reloaded.characters[0].chats[0].databaseBlockStorage?.hash).toBe(firstChatRef?.hash);
    });

    it("keeps older manifests readable after a chat block changes", async () => {
        const storage = new MemoryBlockStorage();
        const db = makeDb();
        const firstManifest = await saveDatabaseBlockDatabase(db, storage);

        db.characters[0].chats[0].message.push({ role: "user", data: "new message" });
        const secondManifest = await saveDatabaseBlockDatabase(db, storage, {
            character: ["char-1"],
            chat: [["char-1", "chat-1"]],
        });

        const firstLoaded = await loadDatabaseBlockDatabase(firstManifest, storage);
        await hydrateDatabaseBlockChat(firstLoaded, storage, 0, 0);
        expect(firstLoaded.characters[0].chats[0].message).toHaveLength(2);

        const secondLoaded = await loadDatabaseBlockDatabase(secondManifest, storage);
        await hydrateDatabaseBlockChat(secondLoaded, storage, 0, 0);
        expect(secondLoaded.characters[0].chats[0].message).toHaveLength(3);
    });
});
