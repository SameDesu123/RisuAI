import { BaseDirectory, exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { compressSync, decompressSync } from "fflate";
import type { Chat, Database, character, groupChat } from "./database.svelte";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const manifestHeader = textEncoder.encode("RISUDBLOCK\x00\x02");
const blockHeader = textEncoder.encode("RISUDBLOCKITEM\x00\x01");
const blockNamespace = "database/blocks/v2";

export const databaseBlockChatHeader = "\uEF01DBBLOCKCHAT\uEF01";

export type DatabaseBlockStorageAdapter = {
    getItem(key: string): Promise<Uint8Array | ArrayBuffer | Buffer | null>;
    setItem(key: string, value: Uint8Array): Promise<unknown>;
    keys?: () => Promise<string[]>;
    removeItem?: (key: string) => Promise<unknown>;
};

export type DatabaseBlockRef = {
    key: string;
    hash: string;
    byteLength: number;
    updatedAt: number;
};

type DatabaseBlockManifest = {
    kind: "risu-database-block-manifest";
    version: 2;
    updatedAt: number;
    root: Record<string, unknown>;
    components: {
        botPresets?: DatabaseBlockRef;
        modules?: DatabaseBlockRef;
        loadouts?: DatabaseBlockRef;
        plugins?: DatabaseBlockRef;
        pluginCustomStorage?: DatabaseBlockRef;
    };
    characters: {
        order: string[];
        refs: Record<string, DatabaseBlockRef>;
        chatRefs: Record<string, {
            order: string[];
            refs: Record<string, DatabaseBlockRef>;
        }>;
    };
};

type DatabaseBlockPayload<T> = {
    kind: "risu-database-block";
    version: 1;
    data: T;
};

export type DatabaseBlockSaveChangeSet = {
    character?: string[];
    chat?: [string, string][];
    botPreset?: boolean;
    modules?: boolean;
    loadouts?: boolean;
    plugins?: boolean;
    pluginCustomStorage?: boolean;
};

type ChatStub = Chat & {
    databaseBlockStorage?: DatabaseBlockRef;
};

function concatBytes(a: Uint8Array, b: Uint8Array) {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
}

function startsWith(data: Uint8Array, prefix: Uint8Array) {
    if (data.length < prefix.length) {
        return false;
    }
    for (let i = 0; i < prefix.length; i++) {
        if (data[i] !== prefix[i]) {
            return false;
        }
    }
    return true;
}

function toUint8Array(data: Uint8Array | ArrayBuffer | Buffer | null): Uint8Array | null {
    if (!data) {
        return null;
    }
    if (data instanceof Uint8Array) {
        return data;
    }
    return new Uint8Array(data);
}

function encodeJsonPayload(header: Uint8Array, data: unknown) {
    const json = textEncoder.encode(JSON.stringify(data));
    return concatBytes(header, compressSync(json));
}

function decodeJsonPayload<T>(header: Uint8Array, data: Uint8Array): T {
    if (!startsWith(data, header)) {
        throw new Error("Invalid database block header");
    }
    const decompressed = decompressSync(data.slice(header.length));
    return JSON.parse(textDecoder.decode(decompressed)) as T;
}

function cloneJson<T>(data: T): T {
    return JSON.parse(JSON.stringify(data));
}

function keyPart(id: string | undefined, fallback: string) {
    const source = id || fallback;
    return Array.from(textEncoder.encode(source))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function parentDir(path: string) {
    const index = path.lastIndexOf("/");
    return index === -1 ? "" : path.slice(0, index);
}

async function sha256Hex(data: Uint8Array) {
    const input = new ArrayBuffer(data.byteLength);
    new Uint8Array(input).set(data);
    const hash = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function writeJsonBlock<T>(storage: DatabaseBlockStorageAdapter, baseKey: string, data: T): Promise<DatabaseBlockRef> {
    const encoded = encodeJsonPayload(blockHeader, {
        kind: "risu-database-block",
        version: 1,
        data,
    } satisfies DatabaseBlockPayload<T>);
    const hash = await sha256Hex(encoded);
    const key = baseKey.endsWith(".bin")
        ? `${baseKey.slice(0, -4)}-${hash.slice(0, 16)}.bin`
        : `${baseKey}-${hash.slice(0, 16)}`;
    await storage.setItem(key, encoded);
    return {
        key,
        hash,
        byteLength: encoded.byteLength,
        updatedAt: Date.now(),
    };
}

async function readJsonBlock<T>(storage: DatabaseBlockStorageAdapter, ref: DatabaseBlockRef): Promise<T> {
    const data = toUint8Array(await storage.getItem(ref.key));
    if (!data) {
        throw new Error(`Missing database block: ${ref.key}`);
    }
    const hash = await sha256Hex(data);
    if (hash !== ref.hash) {
        throw new Error(`Database block hash mismatch: ${ref.key}`);
    }
    const payload = decodeJsonPayload<DatabaseBlockPayload<T>>(blockHeader, data);
    if (payload.kind !== "risu-database-block" || payload.version !== 1) {
        throw new Error(`Invalid database block payload: ${ref.key}`);
    }
    return payload.data;
}

function buildRoot(db: Database) {
    const root: Record<string, unknown> = {};
    for (const key of Object.keys(db)) {
        if (
            key !== "characters" &&
            key !== "botPresets" &&
            key !== "modules" &&
            key !== "loadouts" &&
            key !== "plugins" &&
            key !== "pluginCustomStorage"
        ) {
            root[key] = (db as unknown as Record<string, unknown>)[key];
        }
    }
    root.databaseBlockStorage = true;
    return cloneJson(root);
}

function getChatBlockRef(chat: Chat | undefined): DatabaseBlockRef | null {
    const stub = chat as ChatStub | undefined;
    if (stub?.databaseBlockStorage) {
        return stub.databaseBlockStorage;
    }
    const marker = chat?.message?.[0]?.data;
    if (typeof marker === "string" && marker.startsWith(databaseBlockChatHeader)) {
        try {
            return JSON.parse(marker.slice(databaseBlockChatHeader.length)) as DatabaseBlockRef;
        } catch {
            return null;
        }
    }
    return null;
}

export function isDatabaseBlockManifest(data: Uint8Array | ArrayBuffer | Buffer | null | undefined) {
    const bytes = toUint8Array(data as Uint8Array | ArrayBuffer | Buffer | null);
    return !!bytes && startsWith(bytes, manifestHeader);
}

export function isDatabaseBlockChatStub(chat: Chat | undefined) {
    return !!getChatBlockRef(chat);
}

function makeChatStub(chat: Chat, ref: DatabaseBlockRef): ChatStub {
    return {
        id: chat.id,
        name: chat.name ?? "",
        note: chat.note ?? "",
        localLore: [],
        folderId: chat.folderId,
        lastDate: chat.lastDate,
        bindedPersona: chat.bindedPersona,
        fmIndex: chat.fmIndex,
        bookmarks: chat.bookmarks,
        bookmarkNames: chat.bookmarkNames,
        modules: chat.modules,
        suggestMessages: chat.suggestMessages,
        message: [{
            role: "char",
            data: databaseBlockChatHeader + JSON.stringify(ref),
            time: chat.lastDate ?? Date.now(),
        }],
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

async function normalizeChatForWrite(
    storage: DatabaseBlockStorageAdapter,
    chat: Chat,
): Promise<Chat> {
    const ref = getChatBlockRef(chat);
    if (!ref) {
        const cloned = cloneJson(chat);
        delete (cloned as ChatStub).databaseBlockStorage;
        return cloned;
    }
    const hydrated = await readJsonBlock<Chat>(storage, ref);
    const merged = mergeChatMetadata(hydrated, chat);
    delete (merged as ChatStub).databaseBlockStorage;
    return merged;
}

function makeCharacterMeta(
    char: character | groupChat,
    chatRefs: Record<string, DatabaseBlockRef>,
): character | groupChat {
    const cloned = cloneJson(char);
    cloned.chats = cloned.chats.map((chat, index) => {
        const chatId = chat.id ?? `chat-${index}`;
        const ref = chatRefs[chatId];
        return ref ? makeChatStub(chat, ref) : chat;
    });
    return cloned;
}

export async function encodeDatabaseBlockManifest(manifest: DatabaseBlockManifest) {
    return encodeJsonPayload(manifestHeader, manifest);
}

export function decodeDatabaseBlockManifest(data: Uint8Array | ArrayBuffer | Buffer): DatabaseBlockManifest {
    const bytes = toUint8Array(data as Uint8Array | ArrayBuffer | Buffer);
    const manifest = decodeJsonPayload<DatabaseBlockManifest>(manifestHeader, bytes);
    if (manifest.kind !== "risu-database-block-manifest" || manifest.version !== 2) {
        throw new Error("Unsupported database block manifest");
    }
    return manifest;
}

async function readCurrentManifest(storage: DatabaseBlockStorageAdapter): Promise<DatabaseBlockManifest | null> {
    const current = toUint8Array(await storage.getItem("database/database.bin"));
    if (!isDatabaseBlockManifest(current)) {
        return null;
    }
    return decodeDatabaseBlockManifest(current);
}

function componentChanged(changes: DatabaseBlockSaveChangeSet | undefined, key: keyof DatabaseBlockManifest["components"]) {
    if (!changes) {
        return true;
    }
    if (key === "botPresets") {
        return !!changes.botPreset;
    }
    return !!changes[key as keyof DatabaseBlockSaveChangeSet];
}

async function writeComponent<T>(
    storage: DatabaseBlockStorageAdapter,
    manifest: DatabaseBlockManifest | null,
    nextManifest: DatabaseBlockManifest,
    key: keyof DatabaseBlockManifest["components"],
    value: T,
    changes: DatabaseBlockSaveChangeSet | undefined,
    forceFull: boolean,
) {
    const existing = manifest?.components?.[key];
    if (!forceFull && existing && !componentChanged(changes, key)) {
        nextManifest.components[key] = existing;
        return;
    }
    nextManifest.components[key] = await writeJsonBlock(
        storage,
        `${blockNamespace}/components/${key}.bin`,
        cloneJson(value),
    );
}

export async function saveDatabaseBlockDatabase(
    db: Database,
    storage: DatabaseBlockStorageAdapter,
    changes?: DatabaseBlockSaveChangeSet,
) {
    const currentManifest = await readCurrentManifest(storage);
    const forceFull = !currentManifest;
    const changedCharacters = new Set(changes?.character ?? []);
    const changedChats = new Set((changes?.chat ?? []).map(([chaId, chatId]) => `${chaId}:${chatId}`));

    const nextManifest: DatabaseBlockManifest = {
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

    await writeComponent(storage, currentManifest, nextManifest, "botPresets", db.botPresets ?? [], changes, forceFull);
    await writeComponent(storage, currentManifest, nextManifest, "modules", db.modules ?? [], changes, forceFull);
    await writeComponent(storage, currentManifest, nextManifest, "loadouts", db.loadouts ?? [], changes, forceFull);
    await writeComponent(storage, currentManifest, nextManifest, "plugins", db.plugins ?? [], changes, forceFull);
    await writeComponent(storage, currentManifest, nextManifest, "pluginCustomStorage", db.pluginCustomStorage ?? {}, changes, forceFull);

    for (let characterIndex = 0; characterIndex < db.characters.length; characterIndex++) {
        const char = db.characters[characterIndex];
        const chaId = char.chaId || `character-${characterIndex}`;
        const safeChaId = keyPart(chaId, `character-${characterIndex}`);
        const existingCharacterRef = currentManifest?.characters.refs[chaId];
        const existingChatRefs = currentManifest?.characters.chatRefs[chaId]?.refs ?? {};
        const nextChatRefs: Record<string, DatabaseBlockRef> = {};
        const nextChatOrder: string[] = [];

        for (let chatIndex = 0; chatIndex < char.chats.length; chatIndex++) {
            const chat = char.chats[chatIndex];
            const chatId = chat.id || `chat-${chatIndex}`;
            const existingChatRef = existingChatRefs[chatId] ?? getChatBlockRef(chat);
            const shouldWriteChat =
                forceFull ||
                !existingChatRef ||
                changedChats.has(`${chaId}:${chatId}`) ||
                (changedCharacters.has(chaId) && !getChatBlockRef(chat));
            if (shouldWriteChat) {
                const fullChat = await normalizeChatForWrite(storage, chat);
                nextChatRefs[chatId] = await writeJsonBlock(
                    storage,
                    `${blockNamespace}/characters/${safeChaId}/chats/${keyPart(chatId, `chat-${chatIndex}`)}.bin`,
                    fullChat,
                );
            }
            else {
                nextChatRefs[chatId] = existingChatRef;
            }
            nextChatOrder.push(chatId);
        }

        const shouldWriteCharacter = forceFull || !existingCharacterRef || changedCharacters.has(chaId);
        if (shouldWriteCharacter) {
            nextManifest.characters.refs[chaId] = await writeJsonBlock(
                storage,
                `${blockNamespace}/characters/${safeChaId}/meta.bin`,
                makeCharacterMeta(char, nextChatRefs),
            );
        }
        else {
            nextManifest.characters.refs[chaId] = existingCharacterRef;
        }
        nextManifest.characters.chatRefs[chaId] = {
            order: nextChatOrder,
            refs: nextChatRefs,
        };
        nextManifest.characters.order.push(chaId);
    }

    const manifestBytes = await encodeDatabaseBlockManifest(nextManifest);
    await storage.setItem("database/database.bin", manifestBytes);
    return manifestBytes;
}

export async function loadDatabaseBlockDatabase(
    manifestBytes: Uint8Array | ArrayBuffer | Buffer,
    storage: DatabaseBlockStorageAdapter,
): Promise<Database> {
    const manifest = decodeDatabaseBlockManifest(manifestBytes);
    const db = cloneJson(manifest.root) as unknown as Database;

    db.botPresets = manifest.components.botPresets
        ? await readJsonBlock(storage, manifest.components.botPresets)
        : [];
    db.modules = manifest.components.modules
        ? await readJsonBlock(storage, manifest.components.modules)
        : [];
    db.loadouts = manifest.components.loadouts
        ? await readJsonBlock(storage, manifest.components.loadouts)
        : [];
    db.plugins = manifest.components.plugins
        ? await readJsonBlock(storage, manifest.components.plugins)
        : [];
    db.pluginCustomStorage = manifest.components.pluginCustomStorage
        ? await readJsonBlock(storage, manifest.components.pluginCustomStorage)
        : {};
    db.characters = [];
    db.databaseBlockStorage = true;

    for (const chaId of manifest.characters.order) {
        const charRef = manifest.characters.refs[chaId];
        if (!charRef) {
            continue;
        }
        const char = await readJsonBlock<character | groupChat>(storage, charRef);
        const chatManifest = manifest.characters.chatRefs[chaId];
        if (chatManifest) {
            char.chats = chatManifest.order.map((chatId, index) => {
                const fromMeta = char.chats?.find((chat) => chat.id === chatId) ?? char.chats?.[index];
                const ref = chatManifest.refs[chatId];
                if (!ref) {
                    return fromMeta;
                }
                return makeChatStub(fromMeta ?? ({
                    id: chatId,
                    name: `Chat ${index + 1}`,
                    note: "",
                    localLore: [],
                    message: [],
                } as Chat), ref);
            }).filter(Boolean);
        }
        db.characters.push(char);
    }

    return db;
}

export async function hydrateDatabaseBlockChat(
    db: Database,
    storage: DatabaseBlockStorageAdapter,
    characterIndex: number,
    chatIndex: number,
) {
    const chat = db.characters?.[characterIndex]?.chats?.[chatIndex];
    const ref = getChatBlockRef(chat);
    if (!chat || !ref) {
        return;
    }
    const hydrated = await readJsonBlock<Chat>(storage, ref);
    db.characters[characterIndex].chats[chatIndex] = mergeChatMetadata(hydrated, chat);
}

export async function hydrateDatabaseBlockDatabase(
    db: Database,
    storage: DatabaseBlockStorageAdapter,
): Promise<Database> {
    const cloned = cloneJson(db);
    for (let characterIndex = 0; characterIndex < cloned.characters.length; characterIndex++) {
        const char = cloned.characters[characterIndex];
        for (let chatIndex = 0; chatIndex < char.chats.length; chatIndex++) {
            await hydrateDatabaseBlockChat(cloned, storage, characterIndex, chatIndex);
        }
    }
    return cloned;
}

export function hasDatabaseBlockChatStubs(db: Database | undefined) {
    return !!db?.characters?.some((char) => char?.chats?.some((chat) => isDatabaseBlockChatStub(chat)));
}

export function createAutoDatabaseBlockStorage(storage: {
    getItem(key: string): Promise<Uint8Array | ArrayBuffer | Buffer | null>;
    setItem(key: string, value: Uint8Array): Promise<unknown>;
    keys?: () => Promise<string[]>;
    removeItem?: (key: string) => Promise<unknown>;
}): DatabaseBlockStorageAdapter {
    return storage;
}

export function createTauriDatabaseBlockStorage(): DatabaseBlockStorageAdapter {
    return {
        async getItem(key: string) {
            if (!await exists(key, { baseDir: BaseDirectory.AppData })) {
                return null;
            }
            return await readFile(key, { baseDir: BaseDirectory.AppData });
        },
        async setItem(key: string, value: Uint8Array) {
            const dir = parentDir(key);
            if (dir) {
                await mkdir(dir, { recursive: true, baseDir: BaseDirectory.AppData });
            }
            await writeFile(key, value, { baseDir: BaseDirectory.AppData });
        },
    };
}
