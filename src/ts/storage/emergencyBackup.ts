import localforage from 'localforage';
import { v4 } from 'uuid';
import { language } from 'src/lang';
import { isNodeServer, isTauri } from '../platform';
import { safeStructuredClone } from '../polyfill';
import type { Chat, Database } from './database.svelte';

const BACKUP_PREFIX = 'chat:';
const MAX_BACKUP_COUNT = 50;
const MAX_BACKUP_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface EmergencyBackupRecord {
    version: 1;
    appVer: string;
    savedAt: number;
    charId: string;
    chatId: string;
    charName: string;
    chatName: string;
    messageCount: number;
    lastMessageTime: number;
    fingerprint: string;
    chat: Chat;
}

export interface EmergencyRecoveryCandidate {
    key: string;
    record: EmergencyBackupRecord;
}

export interface EmergencyBackupStorage {
    getItem<T = unknown>(key: string): Promise<T | null>;
    setItem<T = unknown>(key: string, value: T): Promise<T>;
    removeItem(key: string): Promise<void>;
    keys(): Promise<string[]>;
}

const emergencyBackupStorage = localforage.createInstance({
    name: 'risuEmergencyBackup',
});

export function isEmergencyBackupSupported() {
    return typeof window !== 'undefined' && !isTauri && !isNodeServer;
}

function getBackupKey(charId: string, chatId: string) {
    return `${BACKUP_PREFIX}${charId}:${chatId}`;
}

function hashString(value: string) {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

export function getEmergencyChatFingerprint(chat: Chat) {
    return hashString(JSON.stringify(chat));
}

function getChatLatestTime(chat: Chat) {
    let latest = chat.lastDate ?? 0;
    for (const message of chat.message ?? []) {
        latest = Math.max(latest, message.time ?? 0);
    }
    return latest;
}

function isValidRecord(value: unknown): value is EmergencyBackupRecord {
    const record = value as EmergencyBackupRecord;
    return (
        !!record &&
        record.version === 1 &&
        typeof record.savedAt === 'number' &&
        typeof record.charId === 'string' &&
        typeof record.chatId === 'string' &&
        typeof record.fingerprint === 'string' &&
        !!record.chat &&
        Array.isArray(record.chat.message)
    );
}

async function readRecords(storage: EmergencyBackupStorage) {
    const keys = (await storage.keys()).filter((key) => key.startsWith(BACKUP_PREFIX));
    const records: EmergencyRecoveryCandidate[] = [];

    for (const key of keys) {
        try {
            const record = await storage.getItem(key);
            if (isValidRecord(record)) {
                records.push({ key, record });
            }
        } catch (error) {
            console.warn(`Failed to read emergency backup ${key}:`, error);
        }
    }

    return records;
}

export function createEmergencyBackupRecord(arg: {
    db: Database;
    charId: string;
    chatId: string;
    appVer: string;
    now?: number;
}): EmergencyBackupRecord | null {
    const character = arg.db.characters?.find((char) => char.chaId === arg.charId);
    const chat = character?.chats?.find((chatData) => chatData.id === arg.chatId);

    if (!character || !chat) {
        return null;
    }

    const chatSnapshot = safeStructuredClone(chat);

    return {
        version: 1,
        appVer: arg.appVer,
        savedAt: arg.now ?? Date.now(),
        charId: character.chaId,
        chatId: chat.id ?? arg.chatId,
        charName: character.name ?? '',
        chatName: chat.name ?? '',
        messageCount: chat.message?.length ?? 0,
        lastMessageTime: getChatLatestTime(chat),
        fingerprint: getEmergencyChatFingerprint(chatSnapshot),
        chat: chatSnapshot,
    };
}

export async function saveEmergencyChatBackup(arg: {
    db: Database;
    charId: string;
    chatId: string;
    appVer: string;
    storage?: EmergencyBackupStorage;
    now?: number;
}) {
    if (!arg.db.enableEmergencyBackup || !isEmergencyBackupSupported()) {
        return false;
    }

    const record = createEmergencyBackupRecord(arg);
    if (!record) {
        return false;
    }

    const storage = arg.storage ?? emergencyBackupStorage;
    await storage.setItem(getBackupKey(record.charId, record.chatId), record);
    await pruneEmergencyBackups(storage, arg.now ?? record.savedAt);
    return true;
}

export async function pruneEmergencyBackups(
    storage: EmergencyBackupStorage = emergencyBackupStorage,
    now = Date.now(),
) {
    const records = await readRecords(storage);
    const toRemove = new Set<string>();
    const latestByChat = new Map<string, EmergencyRecoveryCandidate>();

    for (const candidate of records) {
        if (now - candidate.record.savedAt > MAX_BACKUP_AGE_MS) {
            toRemove.add(candidate.key);
            continue;
        }

        const chatKey = `${candidate.record.charId}:${candidate.record.chatId}`;
        const previous = latestByChat.get(chatKey);
        if (!previous || previous.record.savedAt < candidate.record.savedAt) {
            if (previous) {
                toRemove.add(previous.key);
            }
            latestByChat.set(chatKey, candidate);
        } else {
            toRemove.add(candidate.key);
        }
    }

    const remaining = records
        .filter((candidate) => !toRemove.has(candidate.key))
        .sort((a, b) => b.record.savedAt - a.record.savedAt);

    for (const extra of remaining.slice(MAX_BACKUP_COUNT)) {
        toRemove.add(extra.key);
    }

    await Promise.all([...toRemove].map((key) => storage.removeItem(key)));
}

export async function getEmergencyRecoveryCandidates(
    db: Database,
    storage: EmergencyBackupStorage = emergencyBackupStorage,
) {
    const candidates: EmergencyRecoveryCandidate[] = [];
    const records = await readRecords(storage);

    for (const candidate of records) {
        const character = db.characters?.find((char) => char.chaId === candidate.record.charId);
        if (!character) {
            continue;
        }

        if (character.chats.some((chat) => getEmergencyChatFingerprint(chat) === candidate.record.fingerprint)) {
            continue;
        }

        const currentChat = character.chats.find((chat) => chat.id === candidate.record.chatId);
        if (!currentChat) {
            candidates.push(candidate);
            continue;
        }

        const currentMessageCount = currentChat.message?.length ?? 0;
        if (
            candidate.record.messageCount > currentMessageCount ||
            (
                candidate.record.fingerprint !== getEmergencyChatFingerprint(currentChat) &&
                candidate.record.savedAt > getChatLatestTime(currentChat)
            )
        ) {
            candidates.push(candidate);
        }
    }

    return candidates.sort((a, b) => b.record.savedAt - a.record.savedAt);
}

export async function applyEmergencyRecoveryCandidates(arg: {
    db: Database;
    candidates: EmergencyRecoveryCandidate[];
    storage?: EmergencyBackupStorage;
    createId?: () => string;
}) {
    const storage = arg.storage ?? emergencyBackupStorage;
    const createId = arg.createId ?? v4;
    let recovered = 0;

    for (const candidate of arg.candidates) {
        const character = arg.db.characters?.find((char) => char.chaId === candidate.record.charId);
        if (!character) {
            continue;
        }

        if (character.chats.some((chat) => getEmergencyChatFingerprint(chat) === candidate.record.fingerprint)) {
            await storage.removeItem(candidate.key);
            continue;
        }

        const restoredChat = safeStructuredClone(candidate.record.chat);
        restoredChat.id = createId();
        restoredChat.name = getRecoveredChatName(candidate.record);
        character.chats.push(restoredChat);
        recovered += 1;
        await storage.removeItem(candidate.key);
    }

    return recovered;
}

export async function discardEmergencyRecoveryCandidates(
    candidates: EmergencyRecoveryCandidate[],
    storage: EmergencyBackupStorage = emergencyBackupStorage,
) {
    await Promise.all(candidates.map((candidate) => storage.removeItem(candidate.key)));
}

export function getEmergencyRecoveryMessage(candidates: EmergencyRecoveryCandidate[]) {
    const totalMessages = candidates.reduce((sum, candidate) => sum + candidate.record.messageCount, 0);
    return language.emergencyBackup.recoveryPrompt
        .replace('{0}', candidates.length.toString())
        .replace('{1}', totalMessages.toString());
}

function getRecoveredChatName(record: EmergencyBackupRecord) {
    const baseName = record.chatName || language.emergencyBackup.untitledChat;
    const date = new Date(record.savedAt).toLocaleString();
    return `${baseName} (${language.emergencyBackup.recoveredChatSuffix} ${date})`;
}
