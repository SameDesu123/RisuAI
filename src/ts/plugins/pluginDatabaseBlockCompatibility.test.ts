import { describe, expect, it, vi } from "vitest";
import {
    readHydratedPluginCharacter,
    readHydratedPluginChat,
    replaceHydratedPluginCharacter,
    replaceHydratedPluginChat,
} from "./pluginDatabaseBlockCompatibility";

describe("plugin database block compatibility", () => {
    it("hydrates current-character reads and detaches changed chats on replacement", async () => {
        const blockRef = { key: "chat.bin", hash: "hash", byteLength: 1, updatedAt: 1 };
        const database = {
            characters: [{
                chaId: "character-1",
                chats: [{ id: "chat-1", message: [], databaseBlockStorage: blockRef }],
            }],
        };
        const hydrate = vi.fn(async () => {
            database.characters[0].chats[0] = {
                id: "chat-1",
                message: [{ role: "user", data: "original" }],
                databaseBlockStorage: blockRef,
            };
        });
        const pluginCharacter = await readHydratedPluginCharacter(
            database,
            0,
            hydrate,
            (character) => structuredClone(character),
        );
        pluginCharacter!.chats![0].message[0].data = "edited";
        const markCharacter = vi.fn();
        const markChat = vi.fn();

        await replaceHydratedPluginCharacter(
            database,
            0,
            pluginCharacter!,
            hydrate,
            markCharacter,
            markChat,
        );

        expect(database.characters[0].chats[0].message[0].data).toBe("edited");
        expect(database.characters[0].chats[0]).not.toHaveProperty("databaseBlockStorage");
        expect(markCharacter).toHaveBeenCalledWith("character-1");
        expect(markChat).toHaveBeenCalledWith("character-1", "chat-1");
    });

    it("replaces the original character after its array index changes during hydration", async () => {
        const first = { chaId: "character-1", chats: [] };
        const second = { chaId: "character-2", chats: [] };
        const database = { characters: [first, second] };
        const replacement = { chaId: "character-1", chats: [] };

        const replaced = await replaceHydratedPluginCharacter(
            database,
            0,
            replacement,
            async () => {
                database.characters.reverse();
            },
            vi.fn(),
            vi.fn(),
        );

        expect(replaced).toBe(true);
        expect(database.characters).toEqual([second, replacement]);
    });

    it("does not overwrite another character when the target disappears during hydration", async () => {
        const first = { chaId: "character-1", chats: [] };
        const second = { chaId: "character-2", chats: [] };
        const database = { characters: [first, second] };

        const replaced = await replaceHydratedPluginCharacter(
            database,
            0,
            { chaId: "replacement", chats: [] },
            async () => {
                database.characters.splice(0, 1);
            },
            vi.fn(),
            vi.fn(),
        );

        expect(replaced).toBe(false);
        expect(database.characters).toEqual([second]);
    });

    it("tracks a chat by identity when its character moves during hydration", async () => {
        const firstChat = { id: "chat-1", message: [{ data: "original" }] };
        const first = { chaId: "character-1", chats: [firstChat] };
        const second = { chaId: "character-2", chats: [] };
        const database = { characters: [first, second] };
        const replacement = { id: "chat-1", message: [{ data: "edited" }] };
        const markChat = vi.fn();

        const replaced = await replaceHydratedPluginChat(
            database,
            0,
            0,
            replacement,
            async () => {
                database.characters.reverse();
                return firstChat;
            },
            vi.fn(),
            markChat,
        );

        expect(replaced).toBe(true);
        expect(database.characters).toEqual([second, first]);
        expect(first.chats[0]).toBe(replacement);
        expect(markChat).toHaveBeenCalledWith("character-1", "chat-1");

        const read = await readHydratedPluginChat(
            database,
            1,
            0,
            async () => replacement,
            (chat) => structuredClone(chat),
        );
        expect(read).toEqual(replacement);
    });
});
