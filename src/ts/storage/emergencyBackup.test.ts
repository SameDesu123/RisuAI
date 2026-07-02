import { describe, expect, it, vi } from 'vitest';
import {
    applyEmergencyRecoveryCandidates,
    clearEmergencyBackups,
    cleanupResolvedEmergencyBackups,
    createEmergencyBackupRecord,
    getEmergencyChatFingerprint,
    getEmergencyRecoveryCandidates,
    pruneEmergencyBackups,
    saveEmergencyChatBackup,
    type EmergencyBackupStorage,
} from './emergencyBackup';
import type { Chat, Database } from './database.svelte';

vi.mock('../platform', () => ({
    isTauri: false,
    isNodeServer: false,
}));

class MemoryStorage implements EmergencyBackupStorage {
    data = new Map<string, unknown>();

    async getItem<T = unknown>(key: string) {
        return (this.data.get(key) as T) ?? null;
    }

    async setItem<T = unknown>(key: string, value: T) {
        this.data.set(key, value);
        return value;
    }

    async removeItem(key: string) {
        this.data.delete(key);
    }

    async keys() {
        return [...this.data.keys()];
    }
}

function chat(id: string, messages: string[], savedAt = 1000): Chat {
    return {
        id,
        name: `Chat ${id}`,
        note: '',
        localLore: [],
        lastDate: savedAt,
        message: messages.map((data, index) => ({
            role: index % 2 === 0 ? 'user' : 'char',
            data,
            time: savedAt + index,
        })),
    };
}

function db(arg: { enabled?: boolean; chat?: Chat } = {}): Database {
    return {
        enableEmergencyBackup: arg.enabled ?? true,
        characters: [
            {
                type: 'character',
                chaId: 'char-1',
                name: 'Character',
                image: '',
                firstMessage: '',
                desc: '',
                notes: '',
                chats: [arg.chat ?? chat('chat-1', ['hello'])],
                chatFolders: [],
                chatPage: 0,
                viewScreen: 'none',
                bias: [],
                emotionImages: [],
                globalLore: [],
                sdData: [],
                customscript: [],
                triggerscript: [],
                utilityBot: false,
                exampleMessage: '',
                creatorNotes: '',
                systemPrompt: '',
                postHistoryInstructions: '',
                alternateGreetings: [],
                tags: [],
                creator: '',
                characterVersion: '',
                personality: '',
                scenario: '',
                firstMsgIndex: 0,
                replaceGlobalNote: '',
                additionalText: '',
            },
        ],
    } as Database;
}

describe('emergencyBackup', () => {
    it('does not save when disabled', async () => {
        const storage = new MemoryStorage();
        const saved = await saveEmergencyChatBackup({
            db: db({ enabled: false }),
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            storage,
        });

        expect(saved).toBe(false);
        expect(await storage.keys()).toEqual([]);
    });

    it('creates a chat backup record', () => {
        const baseChat = chat('chat-1', ['hello'], 3000);
        const targetChat = chat('chat-1', ['hello', 'newer'], 3000);
        const sourceDb = db({ chat: targetChat });
        const record = createEmergencyBackupRecord({
            db: sourceDb,
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            baseChat,
            now: 1234,
        });

        expect(record?.savedAt).toBe(1234);
        expect(record?.version).toBe(2);
        expect(record?.baseFingerprint).toBe(getEmergencyChatFingerprint(baseChat));
        expect(record?.targetFingerprint).toBe(getEmergencyChatFingerprint(targetChat));
        expect(record?.targetMessageCount).toBe(2);
        expect(record?.messageStart).toBe(1);
        expect(record?.messages).toEqual([targetChat.message[1]]);
        expect((record as any)?.chat).toBeUndefined();
    });

    it('keeps the latest record per chat and prunes invalid records', async () => {
        const storage = new MemoryStorage();
        const recent = createEmergencyBackupRecord({
            db: db({ chat: chat('chat-1', ['new'], 2000) }),
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            now: 2000,
        });
        const old = createEmergencyBackupRecord({
            db: db({ chat: chat('chat-1', ['old'], 1000) }),
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            now: 1000,
        });
        const other = createEmergencyBackupRecord({
            db: db({ chat: chat('chat-2', ['kept'], 500) }),
            charId: 'char-1',
            chatId: 'chat-2',
            appVer: 'test',
            now: 500,
        });

        await storage.setItem('chat:char-1:chat-1:old', old);
        await storage.setItem('chat:char-1:chat-1', recent);
        await storage.setItem('chat:char-1:chat-2', other);
        await storage.setItem('chat:broken', { nope: true });

        await pruneEmergencyBackups(storage, 3000);

        expect((await storage.keys()).sort()).toEqual(['chat:char-1:chat-1', 'chat:char-1:chat-2']);
    });

    it('returns only newer recovery candidates', async () => {
        const storage = new MemoryStorage();
        const sourceDb = db({ chat: chat('chat-1', ['hello', 'newer'], 3000) });
        await saveEmergencyChatBackup({
            db: sourceDb,
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            storage,
            baseChat: chat('chat-1', ['hello'], 3000),
            now: 3000,
        });

        const currentDb = db({ chat: chat('chat-1', ['hello'], 3000) });
        const candidates = await getEmergencyRecoveryCandidates(currentDb, storage);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].record.targetMessageCount).toBe(2);
    });

    it('restores candidates as new chats without overwriting the original', async () => {
        const storage = new MemoryStorage();
        const sourceDb = db({ chat: chat('chat-1', ['hello', 'newer'], 3000) });
        await saveEmergencyChatBackup({
            db: sourceDb,
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            storage,
            baseChat: chat('chat-1', ['hello'], 3000),
            now: 3000,
        });

        const currentDb = db({ chat: chat('chat-1', ['hello'], 3000) });
        const candidates = await getEmergencyRecoveryCandidates(currentDb, storage);
        const recovered = await applyEmergencyRecoveryCandidates({
            db: currentDb,
            candidates,
            storage,
            createId: () => 'restored-chat',
        });

        expect(recovered).toBe(1);
        expect(currentDb.characters[0].chats).toHaveLength(2);
        expect(currentDb.characters[0].chats[0].id).toBe('chat-1');
        expect(currentDb.characters[0].chats[1].id).toBe('restored-chat');
        expect(currentDb.characters[0].chats[1].message).toHaveLength(2);
        expect(await storage.keys()).toEqual(['chat:char-1:chat-1']);
        expect((await storage.getItem('chat:char-1:chat-1') as any)?.restoredChatId).toBe('restored-chat');
    });

    it('cleans restored backups only after they are present in the saved database', async () => {
        const storage = new MemoryStorage();
        const sourceDb = db({ chat: chat('chat-1', ['hello', 'newer'], 3000) });
        await saveEmergencyChatBackup({
            db: sourceDb,
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            storage,
            baseChat: chat('chat-1', ['hello'], 3000),
            now: 3000,
        });

        const currentDb = db({ chat: chat('chat-1', ['hello'], 3000) });
        const candidates = await getEmergencyRecoveryCandidates(currentDb, storage);
        await applyEmergencyRecoveryCandidates({
            db: currentDb,
            candidates,
            storage,
            createId: () => 'restored-chat',
        });

        const cleaned = await cleanupResolvedEmergencyBackups(currentDb, storage);

        expect(cleaned).toBe(1);
        expect(await storage.keys()).toEqual([]);
    });

    it('keeps restored metadata when the same backup is saved again before cleanup', async () => {
        const storage = new MemoryStorage();
        const sourceDb = db({ chat: chat('chat-1', ['hello', 'newer'], 3000) });
        await saveEmergencyChatBackup({
            db: sourceDb,
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            storage,
            baseChat: chat('chat-1', ['hello'], 3000),
            now: 3000,
        });

        const currentDb = db({ chat: chat('chat-1', ['hello'], 3000) });
        const candidates = await getEmergencyRecoveryCandidates(currentDb, storage);
        await applyEmergencyRecoveryCandidates({
            db: currentDb,
            candidates,
            storage,
            createId: () => 'restored-chat',
        });
        await saveEmergencyChatBackup({
            db: sourceDb,
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            storage,
            now: 3001,
        });

        expect((await storage.getItem('chat:char-1:chat-1') as any)?.restoredChatId).toBe('restored-chat');
    });

    it('does not duplicate an already restored fingerprint', async () => {
        const storage = new MemoryStorage();
        const backupChat = chat('chat-1', ['hello', 'newer'], 3000);
        const sourceDb = db({ chat: backupChat });
        await saveEmergencyChatBackup({
            db: sourceDb,
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            storage,
            baseChat: chat('chat-1', ['hello'], 3000),
            now: 3000,
        });

        const currentDb = db({ chat: backupChat });
        const candidates = await getEmergencyRecoveryCandidates(currentDb, storage);

        expect(candidates).toHaveLength(0);
    });

    it('keeps a recovery candidate when the current chat no longer matches its base', async () => {
        const storage = new MemoryStorage();
        const sourceDb = db({ chat: chat('chat-1', ['current', 'local unsaved'], 2000) });
        await saveEmergencyChatBackup({
            db: sourceDb,
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            storage,
            baseChat: chat('chat-1', ['current'], 2000),
            now: 3000,
        });

        const currentDb = db({ chat: chat('chat-1', ['other device save'], 4000) });
        const candidates = await getEmergencyRecoveryCandidates(currentDb, storage);
        const cleaned = await cleanupResolvedEmergencyBackups(currentDb, storage);
        const recovered = await applyEmergencyRecoveryCandidates({
            db: currentDb,
            candidates,
            storage,
            createId: () => 'restored-conflict',
        });

        expect(candidates).toHaveLength(1);
        expect(cleaned).toBe(0);
        expect(recovered).toBe(1);
        expect(currentDb.characters[0].chats[1].id).toBe('restored-conflict');
        expect(currentDb.characters[0].chats[1].message).toEqual([sourceDb.characters[0].chats[0].message[1]]);
        expect(await storage.keys()).toEqual(['chat:char-1:chat-1']);
    });

    it('clears all emergency backup entries', async () => {
        const storage = new MemoryStorage();
        await storage.setItem('chat:char-1:chat-1', createEmergencyBackupRecord({
            db: db({ chat: chat('chat-1', ['hello', 'newer'], 3000) }),
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            baseChat: chat('chat-1', ['hello'], 3000),
        }));
        await storage.setItem('other:key', { kept: true });

        const cleared = await clearEmergencyBackups(storage);

        expect(cleared).toBe(1);
        expect(await storage.keys()).toEqual(['other:key']);
    });

    it('returns an equal-length recovery candidate when the backed up chat has newer message time', async () => {
        const storage = new MemoryStorage();
        const sourceDb = db({ chat: chat('chat-1', ['newer edit'], 3000) });
        await saveEmergencyChatBackup({
            db: sourceDb,
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            storage,
            baseChat: chat('chat-1', ['old edit'], 1000),
            now: 3000,
        });

        const currentDb = db({ chat: chat('chat-1', ['old edit'], 1000) });
        const candidates = await getEmergencyRecoveryCandidates(currentDb, storage);

        expect(candidates).toHaveLength(1);
    });

    it('does not recover a backup that matches the resolved cold-storage chat', async () => {
        const storage = new MemoryStorage();
        const fullChat = chat('chat-1', ['hello', 'cold'], 3000);
        await saveEmergencyChatBackup({
            db: db({ chat: fullChat }),
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            storage,
            baseChat: chat('chat-1', ['hello'], 3000),
            now: 3000,
        });

        const coldChat: Chat = {
            ...fullChat,
            message: [{
                role: 'char',
                data: 'cold:key-1',
                time: 4000,
            }],
            hypaV2Data: {
                chunks: [],
                mainChunks: [],
                lastMainChunkID: 0,
            },
            hypaV3Data: {
                summaries: [],
            },
            scriptstate: {},
            localLore: [],
        } as Chat;
        const currentDb = db({ chat: coldChat });
        const candidates = await getEmergencyRecoveryCandidates(currentDb, {
            storage,
            resolveCurrentChat: (candidateChat) => candidateChat.message[0]?.data === 'cold:key-1' ? fullChat : null,
        });

        expect(candidates).toHaveLength(0);
    });
});
