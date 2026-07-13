import { describe, expect, it, vi } from "vitest";
import {
    readHydratedPluginCharacter,
    replaceHydratedPluginCharacter,
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
});
