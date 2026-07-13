import { describe, expect, it } from "vitest";
import type { Database } from "./database.svelte";
import { readDatabaseBlock, type DatabaseBlockStorageAdapter } from "./databaseBlockFormat";
import { createDatabaseBlockManifest, type DatabaseBlockStoredCharacter } from "./databaseBlockWriter";

class MemoryBlockStorage implements DatabaseBlockStorageAdapter {
    values = new Map<string, Uint8Array>();

    async getItem(key: string) {
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
                    { role: "user", data: "hello" },
                    { role: "char", data: "hi" },
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
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        language: "en",
    } as unknown as Database;
}

describe("databaseBlockWriter", () => {
    it("writes components, character metadata, and chats as separate blocks", async () => {
        const storage = new MemoryBlockStorage();
        const db = createDatabase();
        const manifest = await createDatabaseBlockManifest(db, storage);

        expect(manifest.root.characters).toBeUndefined();
        expect(manifest.root.databaseBlockStorage).toBe(true);
        expect(Object.keys(manifest.components)).toHaveLength(5);
        expect(manifest.characters.order).toEqual(["char-1"]);

        const stored = await readDatabaseBlock<DatabaseBlockStoredCharacter>(
            storage,
            manifest.characters.refs["char-1"],
        );
        expect(stored.data.name).toBe("Character");
        expect(stored.chats[0].id).toBe("chat-1");
        expect(stored).not.toHaveProperty("data.chats");

        const chat = await readDatabaseBlock<any>(storage, manifest.characters.chatRefs["char-1"].refs["chat-1"]);
        expect(chat.message).toHaveLength(2);
    });

    it("reuses unchanged blocks during incremental saves", async () => {
        const storage = new MemoryBlockStorage();
        const db = createDatabase();
        const first = await createDatabaseBlockManifest(db, storage);

        db.characters[0].name = "Renamed";
        const second = await createDatabaseBlockManifest(db, storage, first, {
            character: ["char-1"],
        });

        expect(second.characters.refs["char-1"].hash).not.toBe(first.characters.refs["char-1"].hash);
        expect(second.characters.chatRefs["char-1"].refs["chat-1"].hash)
            .toBe(first.characters.chatRefs["char-1"].refs["chat-1"].hash);
        expect(second.components.botPresets.hash).toBe(first.components.botPresets.hash);
    });

    it("keeps blocks referenced by an older manifest readable", async () => {
        const storage = new MemoryBlockStorage();
        const db = createDatabase();
        const first = await createDatabaseBlockManifest(db, storage);
        const firstChat = first.characters.chatRefs["char-1"].refs["chat-1"];

        db.characters[0].chats[0].message.push({ role: "user", data: "new message" } as any);
        const second = await createDatabaseBlockManifest(db, storage, first, {
            chat: [["char-1", "chat-1"]],
        });

        expect(second.characters.chatRefs["char-1"].refs["chat-1"].hash).not.toBe(firstChat.hash);
        expect((await readDatabaseBlock<any>(storage, firstChat)).message).toHaveLength(2);
    });
});
