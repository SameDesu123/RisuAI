import type { Chat, Database, character, groupChat } from "./database.svelte";
import {
    databaseBlockNamespace,
    getAttachedDatabaseBlockRef,
    writeDatabaseBlock,
    type DatabaseBlockManifest,
    type DatabaseBlockRef,
    type DatabaseBlockStorageAdapter,
} from "./databaseBlockFormat";

const componentKeys = [
    "botPresets",
    "modules",
    "loadouts",
    "plugins",
    "pluginCustomStorage",
] as const;

type DatabaseBlockComponentKey = typeof componentKeys[number];

export type DatabaseBlockSaveChangeSet = {
    character?: string[];
    chat?: [string, string][];
    botPreset?: boolean;
    modules?: boolean;
    loadouts?: boolean;
    plugins?: boolean;
    pluginCustomStorage?: boolean;
};

export type DatabaseBlockChatMetadata = Pick<
    Chat,
    | "id"
    | "name"
    | "note"
    | "folderId"
    | "lastDate"
    | "bindedPersona"
    | "fmIndex"
    | "bookmarks"
    | "bookmarkNames"
    | "modules"
    | "suggestMessages"
>;

export type DatabaseBlockStoredCharacter = {
    data: Omit<character | groupChat, "chats">;
    chats: DatabaseBlockChatMetadata[];
};

function cloneJson<T>(data: T): T {
    return JSON.parse(JSON.stringify(data));
}

function keyPart(id: string) {
    return Array.from(new TextEncoder().encode(id))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function sameOrder(first: string[] | undefined, second: string[]) {
    return first?.length === second.length && first.every((value, index) => value === second[index]);
}

function buildRoot(db: Database) {
    const root: Record<string, unknown> = {};
    for (const key of Object.keys(db)) {
        if (key !== "characters" && !componentKeys.includes(key as DatabaseBlockComponentKey)) {
            root[key] = (db as unknown as Record<string, unknown>)[key];
        }
    }
    root.databaseBlockStorage = true;
    return cloneJson(root);
}

function chatMetadata(chat: Chat): DatabaseBlockChatMetadata {
    return cloneJson({
        id: chat.id,
        name: chat.name ?? "",
        note: chat.note ?? "",
        folderId: chat.folderId,
        lastDate: chat.lastDate,
        bindedPersona: chat.bindedPersona,
        fmIndex: chat.fmIndex,
        bookmarks: chat.bookmarks,
        bookmarkNames: chat.bookmarkNames,
        modules: chat.modules,
        suggestMessages: chat.suggestMessages,
    });
}

function storedCharacter(char: character | groupChat): DatabaseBlockStoredCharacter {
    const cloned = cloneJson(char);
    const chats = cloned.chats.map(chatMetadata);
    delete (cloned as Partial<character | groupChat>).chats;
    return {
        data: cloned as Omit<character | groupChat, "chats">,
        chats,
    };
}

function componentChanged(changes: DatabaseBlockSaveChangeSet | undefined, key: DatabaseBlockComponentKey) {
    if (!changes) {
        return true;
    }
    return key === "botPresets" ? !!changes.botPreset : !!changes[key];
}

async function writeComponent(
    db: Database,
    storage: DatabaseBlockStorageAdapter,
    previous: DatabaseBlockManifest | undefined,
    next: DatabaseBlockManifest,
    changes: DatabaseBlockSaveChangeSet | undefined,
    key: DatabaseBlockComponentKey,
) {
    const existing = previous?.components[key];
    if (existing && !componentChanged(changes, key)) {
        next.components[key] = existing;
        return;
    }
    next.components[key] = await writeDatabaseBlock(
        storage,
        `${databaseBlockNamespace}/components/${key}.bin`,
        cloneJson((db as unknown as Record<string, unknown>)[key]),
    );
}

export async function createDatabaseBlockManifest(
    db: Database,
    storage: DatabaseBlockStorageAdapter,
    previous?: DatabaseBlockManifest,
    changes?: DatabaseBlockSaveChangeSet,
) {
    const next: DatabaseBlockManifest = {
        kind: "risu-database-block-manifest",
        version: 2,
        updatedAt: Date.now(),
        root: buildRoot(db),
        components: {},
        characters: {
            order: [],
            refs: {},
            chatRefs: {},
        },
    };
    const changedCharacters = new Set(changes?.character ?? []);
    const changedChats = new Set((changes?.chat ?? []).map(([characterId, chatId]) => `${characterId}:${chatId}`));

    for (const key of componentKeys) {
        await writeComponent(db, storage, previous, next, changes, key);
    }

    for (let characterIndex = 0; characterIndex < db.characters.length; characterIndex++) {
        const char = db.characters[characterIndex];
        const characterId = char.chaId || `character-${characterIndex}`;
        const characterKey = keyPart(characterId);
        const previousChats = previous?.characters.chatRefs[characterId];
        const chatOrder: string[] = [];
        const chatRefs: Record<string, DatabaseBlockRef> = {};
        let chatChanged = false;

        for (let chatIndex = 0; chatIndex < char.chats.length; chatIndex++) {
            const chat = char.chats[chatIndex];
            const chatId = chat.id || `chat-${chatIndex}`;
            const attached = getAttachedDatabaseBlockRef(chat);
            const existing = previousChats?.refs[chatId] ?? attached;
            const changed = changedChats.has(`${characterId}:${chatId}`);
            if (!existing || (changed && !attached)) {
                chatRefs[chatId] = await writeDatabaseBlock(
                    storage,
                    `${databaseBlockNamespace}/characters/${characterKey}/chats/${keyPart(chatId)}.bin`,
                    cloneJson(chat),
                );
                chatChanged = true;
            }
            else {
                chatRefs[chatId] = existing;
            }
            if (changed) {
                chatChanged = true;
            }
            chatOrder.push(chatId);
        }

        if (!sameOrder(previousChats?.order, chatOrder)) {
            chatChanged = true;
        }

        const existingCharacter = previous?.characters.refs[characterId];
        if (!existingCharacter || changedCharacters.has(characterId) || chatChanged) {
            next.characters.refs[characterId] = await writeDatabaseBlock(
                storage,
                `${databaseBlockNamespace}/characters/${characterKey}/meta.bin`,
                storedCharacter(char),
            );
        }
        else {
            next.characters.refs[characterId] = existingCharacter;
        }
        next.characters.chatRefs[characterId] = {
            order: chatOrder,
            refs: chatRefs,
        };
        next.characters.order.push(characterId);
    }

    return next;
}
