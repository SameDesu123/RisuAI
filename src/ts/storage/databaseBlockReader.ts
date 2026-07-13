import type { Chat, Database, character, groupChat } from "./database.svelte";
import {
    getAttachedDatabaseBlockRef,
    readDatabaseBlock,
    type DatabaseBlockManifest,
    type DatabaseBlockRef,
    type DatabaseBlockStorageAdapter,
} from "./databaseBlockFormat";
import type { DatabaseBlockChatMetadata, DatabaseBlockStoredCharacter } from "./databaseBlockWriter";

const componentDefaults = {
    botPresets: [],
    modules: [],
    loadouts: [],
    plugins: [],
    pluginCustomStorage: {},
};

type DatabaseBlockChatStub = Chat & {
    databaseBlockStorage: DatabaseBlockRef;
};

function cloneJson<T>(data: T): T {
    return JSON.parse(JSON.stringify(data));
}

function chatBlockRef(chat: Chat | undefined) {
    return getAttachedDatabaseBlockRef(chat);
}

function createChatStub(
    chatId: string,
    metadata: DatabaseBlockChatMetadata | undefined,
    ref: DatabaseBlockRef,
): DatabaseBlockChatStub {
    return {
        id: chatId,
        name: metadata?.name ?? "",
        note: metadata?.note ?? "",
        localLore: [],
        folderId: metadata?.folderId,
        lastDate: metadata?.lastDate,
        bindedPersona: metadata?.bindedPersona,
        fmIndex: metadata?.fmIndex,
        bookmarks: metadata?.bookmarks,
        bookmarkNames: metadata?.bookmarkNames,
        modules: metadata?.modules,
        suggestMessages: metadata?.suggestMessages,
        message: [],
        databaseBlockStorage: ref,
    };
}

function mergeChatMetadata(hydrated: Chat, stub: Chat): Chat {
    return {
        ...hydrated,
        id: stub.id ?? hydrated.id,
        name: stub.name ?? hydrated.name,
        note: stub.note ?? hydrated.note,
        folderId: stub.folderId ?? hydrated.folderId,
        lastDate: stub.lastDate ?? hydrated.lastDate,
        bindedPersona: stub.bindedPersona ?? hydrated.bindedPersona,
        fmIndex: stub.fmIndex ?? hydrated.fmIndex,
        bookmarks: stub.bookmarks ?? hydrated.bookmarks,
        bookmarkNames: stub.bookmarkNames ?? hydrated.bookmarkNames,
        modules: stub.modules ?? hydrated.modules,
        suggestMessages: stub.suggestMessages ?? hydrated.suggestMessages,
    };
}

export function isDatabaseBlockChatStub(chat: Chat | undefined) {
    return !!chatBlockRef(chat);
}

export function hasDatabaseBlockChatStubs(db: Database | undefined) {
    return !!db?.characters?.some((char) => char.chats?.some(isDatabaseBlockChatStub));
}

export async function loadDatabaseBlockDatabase(
    manifest: DatabaseBlockManifest,
    storage: DatabaseBlockStorageAdapter,
): Promise<Database> {
    const db = await readDatabaseBlock<Database>(storage, manifest.root);

    for (const [key, fallback] of Object.entries(componentDefaults)) {
        const ref = manifest.components[key];
        if (!ref) {
            throw new Error(`Missing database component reference: ${key}`);
        }
        (db as unknown as Record<string, unknown>)[key] = await readDatabaseBlock(storage, ref);
    }

    db.characters = [];
    db.databaseBlockStorage = true;
    for (const characterId of manifest.characters.order) {
        const characterRef = manifest.characters.refs[characterId];
        if (!characterRef) {
            throw new Error(`Missing character block reference: ${characterId}`);
        }
        const stored = await readDatabaseBlock<DatabaseBlockStoredCharacter>(storage, characterRef);
        const chatManifest = manifest.characters.chatRefs[characterId];
        if (!chatManifest) {
            throw new Error(`Missing chat block references: ${characterId}`);
        }
        const chats = chatManifest.order.map((chatId, index) => {
            const ref = chatManifest.refs[chatId];
            if (!ref) {
                throw new Error(`Missing chat block reference: ${characterId}/${chatId}`);
            }
            const metadata = stored.chats.find((chat) => chat.id === chatId) ?? stored.chats[index];
            return createChatStub(chatId, metadata, ref);
        });
        db.characters.push({
            ...stored.data,
            chats,
        } as unknown as character | groupChat);
    }
    return db;
}

export async function hydrateDatabaseBlockChat(
    db: Database,
    storage: DatabaseBlockStorageAdapter,
    characterIndex: number,
    chatIndex: number,
    beforeCommit?: (chat: Chat) => void,
) {
    const chat = db.characters?.[characterIndex]?.chats?.[chatIndex];
    const ref = chatBlockRef(chat);
    if (!chat || !ref) {
        return chat;
    }
    const hydrated = await readDatabaseBlock<Chat>(storage, ref);
    const merged = mergeChatMetadata(hydrated, chat);
    beforeCommit?.(merged);
    db.characters[characterIndex].chats[chatIndex] = merged;
    return merged;
}

export async function hydrateDatabaseBlockDatabase(
    db: Database,
    storage: DatabaseBlockStorageAdapter,
) {
    const hydrated = cloneJson(db);
    for (let characterIndex = 0; characterIndex < hydrated.characters.length; characterIndex++) {
        const chats = hydrated.characters[characterIndex].chats;
        for (let chatIndex = 0; chatIndex < chats.length; chatIndex++) {
            await hydrateDatabaseBlockChat(hydrated, storage, characterIndex, chatIndex);
        }
    }
    return hydrated;
}
