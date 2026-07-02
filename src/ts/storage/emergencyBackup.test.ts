import { describe, expect, it, vi } from 'vitest';
import {
    applyEmergencyRecoveryCandidates,
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
        const sourceDb = db();
        const record = createEmergencyBackupRecord({
            db: sourceDb,
            charId: 'char-1',
            chatId: 'chat-1',
            appVer: 'test',
            now: 1234,
        });

        expect(record?.savedAt).toBe(1234);
        expect(record?.messageCount).toBe(1);
        expect(record?.fingerprint).toBe(getEmergencyChatFingerprint(sourceDb.characters[0].chats[0]));
    });

    it('keeps the latest record per chat and prunes old records', async () => {
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
        const now = 3000;
        const expiredAt = now - (31 * 24 * 60 * 60 * 1000);
        const expired = createEmergencyBackupRecord({
            db: db({ chat: chat('chat-2', ['expired'], expiredAt) }),
            charId: 'char-1',
            chatId: 'chat-2',
            appVer: 'test',
            now: expiredAt,
        });

        await storage.setItem('chat:char-1:chat-1:old', old);
        await storage.setItem('chat:char-1:chat-1', recent);
        await storage.setItem('chat:char-1:chat-2', expired);

        await pruneEmergencyBackups(storage, now);

        expect(await storage.keys()).toEqual(['chat:char-1:chat-1']);
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
            now: 3000,
        });

        const currentDb = db({ chat: chat('chat-1', ['hello'], 1000) });
        const candidates = await getEmergencyRecoveryCandidates(currentDb, storage);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].record.messageCount).toBe(2);
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
            now: 3000,
        });

        const currentDb = db({ chat: chat('chat-1', ['hello'], 1000) });
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
        expect(await storage.keys()).toEqual([]);
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
            now: 3000,
        });

        const currentDb = db({ chat: backupChat });
        const candidates = await getEmergencyRecoveryCandidates(currentDb, storage);

        expect(candidates).toHaveLength(0);
    });
});
