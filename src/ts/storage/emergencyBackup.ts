import localforage from 'localforage';
import { v4 } from 'uuid';
import { language } from 'src/lang';
import { isNodeServer, isTauri } from '../platform';
import { safeStructuredClone } from '../polyfill';
import type { Chat, Database } from './database.svelte';

const BACKUP_PREFIX = 'chat:';

export interface EmergencyBackupRecord {
    version: 2;
    appVer: string;
    savedAt: number;
    charId: string;
    chatId: string;
    charName: string;
    chatName: string;
    targetMessageCount: number;
    lastMessageTime: number;
    baseFingerprint: string;
    targetFingerprint: string;
    baseMessageCount: number;
    messageStart: number;
    messages: Chat['message'];
    chatMeta: Omit<Chat, 'message'>;
    restoredChatId?: string;
    restoredAt?: number;
}

interface LegacyEmergencyBackupRecord {
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
    restoredChatId?: string;
    restoredAt?: number;
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

export interface EmergencyRecoveryCandidateOptions {
    storage?: EmergencyBackupStorage;
    resolveCurrentChat?: (chat: Chat) => Chat | null | Promise<Chat | null>;
}

const emergencyBackupStorage = localforage.createInstance({
    name: 'risuEmergencyBackup',
});

const emergencyBackupBases = new Map<string, {
    fingerprint: string;
    messageFingerprints: string[];
}>();

export function isEmergencyBackupSupported() {
    return typeof window !== 'undefined' && !isTauri && !isNodeServer;
}

function getBackupKey(charId: string, chatId: string) {
    return `${BACKUP_PREFIX}${charId}:${chatId}`;
}

function getBaseKey(charId: string, chatId: string) {
    return `${charId}:${chatId}`;
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

function getMessageFingerprints(chat: Chat) {
    return (chat.message ?? []).map((message) => hashString(JSON.stringify(message)));
}

function getChatMeta(chat: Chat): Omit<Chat, 'message'> {
    const { message: _message, ...chatMeta } = safeStructuredClone(chat);
    return chatMeta;
}

function createBaseSnapshot(chat: Chat) {
    return {
        fingerprint: getEmergencyChatFingerprint(chat),
        messageFingerprints: getMessageFingerprints(chat),
    };
}

export function registerEmergencyBackupBaseSnapshots(
    db: Database,
    targets?: [string, string][],
) {
    const targetKeys = targets ? new Set(targets.map(([charId, chatId]) => getBaseKey(charId, chatId))) : null;

    for (const character of db.characters ?? []) {
        for (const chat of character.chats ?? []) {
            if (!chat.id) {
                continue;
            }

            const baseKey = getBaseKey(character.chaId, chat.id);
            if (targetKeys && !targetKeys.has(baseKey)) {
                continue;
            }

            emergencyBackupBases.set(baseKey, createBaseSnapshot(chat));
        }
    }
}

function getChatLatestTime(chat: Chat) {
    let latest = chat.lastDate ?? 0;
    for (const message of chat.message ?? []) {
        latest = Math.max(latest, message.time ?? 0);
    }
    return latest;
}

function isValidV2Record(value: unknown): value is EmergencyBackupRecord {
    const record = value as EmergencyBackupRecord;
    return (
        !!record &&
        record.version === 2 &&
        typeof record.savedAt === 'number' &&
        typeof record.charId === 'string' &&
        typeof record.chatId === 'string' &&
        typeof record.baseFingerprint === 'string' &&
        typeof record.targetFingerprint === 'string' &&
        typeof record.messageStart === 'number' &&
        !!record.chatMeta &&
        Array.isArray(record.messages)
    );
}

function isValidLegacyRecord(value: unknown): value is LegacyEmergencyBackupRecord {
    const record = value as LegacyEmergencyBackupRecord;
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

function normalizeRecord(value: unknown): EmergencyBackupRecord | null {
    if (isValidV2Record(value)) {
        return value;
    }

    if (!isValidLegacyRecord(value)) {
        return null;
    }

    return {
        version: 2,
        appVer: value.appVer,
        savedAt: value.savedAt,
        charId: value.charId,
        chatId: value.chatId,
        charName: value.charName,
        chatName: value.chatName,
        targetMessageCount: value.messageCount,
        lastMessageTime: value.lastMessageTime,
        baseFingerprint: '',
        targetFingerprint: value.fingerprint,
        baseMessageCount: 0,
        messageStart: 0,
        messages: safeStructuredClone(value.chat.message ?? []),
        chatMeta: getChatMeta(value.chat),
        restoredChatId: value.restoredChatId,
        restoredAt: value.restoredAt,
    };
}

function isStorage(value: unknown): value is EmergencyBackupStorage {
    const storage = value as EmergencyBackupStorage;
    return (
        !!storage &&
        typeof storage.getItem === 'function' &&
        typeof storage.setItem === 'function' &&
        typeof storage.removeItem === 'function' &&
        typeof storage.keys === 'function'
    );
}

function normalizeRecoveryOptions(
    options?: EmergencyBackupStorage | EmergencyRecoveryCandidateOptions,
): EmergencyRecoveryCandidateOptions {
    if (!options) {
        return {};
    }

    if (isStorage(options)) {
        return { storage: options };
    }

    return options;
}

async function getComparableChat(
    chat: Chat,
    resolveCurrentChat?: EmergencyRecoveryCandidateOptions['resolveCurrentChat'],
) {
    if (!resolveCurrentChat) {
        return chat;
    }

    try {
        return (await resolveCurrentChat(chat)) ?? chat;
    } catch (error) {
        console.warn('Failed to resolve chat for emergency backup comparison:', error);
        return chat;
    }
}

function hasResolvedEmergencyBackup(character: Database['characters'][number], record: EmergencyBackupRecord) {
    return !!record.restoredChatId && character.chats.some((chat) => chat.id === record.restoredChatId);
}

async function hasMatchingChatFingerprint(
    character: Database['characters'][number],
    fingerprint: string,
    resolveCurrentChat?: EmergencyRecoveryCandidateOptions['resolveCurrentChat'],
) {
    for (const chat of character.chats) {
        const comparableChat = await getComparableChat(chat, resolveCurrentChat);
        if (getEmergencyChatFingerprint(comparableChat) === fingerprint) {
            return true;
        }
    }

    return false;
}

async function readEntries(storage: EmergencyBackupStorage) {
    const keys = (await storage.keys()).filter((key) => key.startsWith(BACKUP_PREFIX));
    const records: EmergencyRecoveryCandidate[] = [];
    const invalidKeys: string[] = [];

    for (const key of keys) {
        try {
            const record = await storage.getItem(key);
            const normalizedRecord = normalizeRecord(record);
            if (normalizedRecord) {
                records.push({ key, record: normalizedRecord });
            } else {
                invalidKeys.push(key);
            }
        } catch (error) {
            console.warn(`Failed to read emergency backup ${key}:`, error);
        }
    }

    return { records, invalidKeys };
}

async function readRecords(storage: EmergencyBackupStorage) {
    const { records } = await readEntries(storage);
    return records;
}

export function createEmergencyBackupRecord(arg: {
    db: Database;
    charId: string;
    chatId: string;
    appVer: string;
    baseChat?: Chat | null;
    now?: number;
}): EmergencyBackupRecord | null {
    const character = arg.db.characters?.find((char) => char.chaId === arg.charId);
    const chat = character?.chats?.find((chatData) => chatData.id === arg.chatId);

    if (!character || !chat) {
        return null;
    }

    const chatSnapshot = safeStructuredClone(chat);
    const targetFingerprint = getEmergencyChatFingerprint(chatSnapshot);
    const baseSnapshot = arg.baseChat
        ? createBaseSnapshot(arg.baseChat)
        : emergencyBackupBases.get(getBaseKey(character.chaId, chat.id ?? arg.chatId));

    if (baseSnapshot?.fingerprint === targetFingerprint) {
        return null;
    }

    const targetMessageFingerprints = getMessageFingerprints(chatSnapshot);
    let messageStart = 0;
    if (baseSnapshot) {
        messageStart = targetMessageFingerprints.findIndex((fingerprint, index) => (
            baseSnapshot.messageFingerprints[index] !== fingerprint
        ));
        if (messageStart === -1) {
            messageStart = Math.min(baseSnapshot.messageFingerprints.length, targetMessageFingerprints.length);
        }
    }

    return {
        version: 2,
        appVer: arg.appVer,
        savedAt: arg.now ?? Date.now(),
        charId: character.chaId,
        chatId: chat.id ?? arg.chatId,
        charName: character.name ?? '',
        chatName: chat.name ?? '',
        targetMessageCount: chat.message?.length ?? 0,
        lastMessageTime: getChatLatestTime(chat),
        baseFingerprint: baseSnapshot?.fingerprint ?? '',
        targetFingerprint,
        baseMessageCount: baseSnapshot?.messageFingerprints.length ?? 0,
        messageStart,
        messages: safeStructuredClone((chatSnapshot.message ?? []).slice(messageStart)),
        chatMeta: getChatMeta(chatSnapshot),
    };
}

export async function saveEmergencyChatBackup(arg: {
    db: Database;
    charId: string;
    chatId: string;
    appVer: string;
    storage?: EmergencyBackupStorage;
    baseChat?: Chat | null;
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
    const key = getBackupKey(record.charId, record.chatId);
    let previous: unknown = null;
    try {
        previous = await storage.getItem(key);
    } catch (error) {
        console.warn(`Failed to read previous emergency backup ${key}:`, error);
    }

    const previousRecord = normalizeRecord(previous);
    if (
        previousRecord?.targetFingerprint === record.targetFingerprint &&
        previousRecord.restoredChatId
    ) {
        record.restoredChatId = previousRecord?.restoredChatId;
        record.restoredAt = previousRecord?.restoredAt;
    }

    await storage.setItem(key, record);
    await pruneEmergencyBackups(storage, arg.now ?? record.savedAt);
    return true;
}

export async function pruneEmergencyBackups(
    storage: EmergencyBackupStorage = emergencyBackupStorage,
    _now = Date.now(),
) {
    const { records, invalidKeys } = await readEntries(storage);
    const toRemove = new Set<string>(invalidKeys);
    const latestByChat = new Map<string, EmergencyRecoveryCandidate>();

    for (const candidate of records) {
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

    await Promise.all([...toRemove].map((key) => storage.removeItem(key)));
}

export async function getEmergencyRecoveryCandidates(
    db: Database,
    options?: EmergencyBackupStorage | EmergencyRecoveryCandidateOptions,
) {
    const {
        storage = emergencyBackupStorage,
        resolveCurrentChat,
    } = normalizeRecoveryOptions(options);
    const candidates: EmergencyRecoveryCandidate[] = [];
    const records = await readRecords(storage);

    for (const candidate of records) {
        const character = db.characters?.find((char) => char.chaId === candidate.record.charId);
        if (!character) {
            continue;
        }

        if (
            hasResolvedEmergencyBackup(character, candidate.record) ||
            await hasMatchingChatFingerprint(character, candidate.record.targetFingerprint, resolveCurrentChat)
        ) {
            continue;
        }

        const currentChat = character.chats.find((chat) => chat.id === candidate.record.chatId);
        if (!currentChat) {
            if (candidate.record.messageStart === 0) {
                candidates.push(candidate);
            }
            continue;
        }

        const comparableCurrentChat = await getComparableChat(currentChat, resolveCurrentChat);
        const currentFingerprint = getEmergencyChatFingerprint(comparableCurrentChat);
        if (
            candidate.record.baseFingerprint &&
            currentFingerprint !== candidate.record.baseFingerprint
        ) {
            candidates.push(candidate);
            continue;
        }

        const currentMessageCount = comparableCurrentChat.message?.length ?? 0;
        const currentLatestTime = getChatLatestTime(comparableCurrentChat);
        if (
            candidate.record.targetFingerprint !== currentFingerprint &&
            (
                currentFingerprint === candidate.record.baseFingerprint ||
                candidate.record.targetMessageCount > currentMessageCount ||
                candidate.record.lastMessageTime > currentLatestTime
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

        if (character.chats.some((chat) => getEmergencyChatFingerprint(chat) === candidate.record.targetFingerprint)) {
            continue;
        }

        const baseChat = character.chats.find((chat) => chat.id === candidate.record.chatId);
        const restoredChat = buildRecoveredChat(candidate.record, baseChat);
        if (!restoredChat) {
            continue;
        }

        restoredChat.id = createId();
        restoredChat.name = getRecoveredChatName(candidate.record);
        character.chats.push(restoredChat);
        recovered += 1;
        await storage.setItem(candidate.key, {
            ...candidate.record,
            restoredChatId: restoredChat.id,
            restoredAt: Date.now(),
        });
    }

    return recovered;
}

export async function cleanupResolvedEmergencyBackups(
    db: Database,
    storage: EmergencyBackupStorage = emergencyBackupStorage,
) {
    const records = await readRecords(storage);
    const toRemove = records.filter((candidate) => {
        const character = db.characters?.find((char) => char.chaId === candidate.record.charId);
        return !!character && (
            hasResolvedEmergencyBackup(character, candidate.record) ||
            character.chats.some((chat) => getEmergencyChatFingerprint(chat) === candidate.record.targetFingerprint)
        );
    });

    await Promise.all(toRemove.map((candidate) => storage.removeItem(candidate.key)));
    return toRemove.length;
}

export async function discardEmergencyRecoveryCandidates(
    candidates: EmergencyRecoveryCandidate[],
    storage: EmergencyBackupStorage = emergencyBackupStorage,
) {
    await Promise.all(candidates.map((candidate) => storage.removeItem(candidate.key)));
}

export async function clearEmergencyBackups(
    storage: EmergencyBackupStorage = emergencyBackupStorage,
) {
    const keys = (await storage.keys()).filter((key) => key.startsWith(BACKUP_PREFIX));
    await Promise.all(keys.map((key) => storage.removeItem(key)));
    emergencyBackupBases.clear();
    return keys.length;
}

export function getEmergencyRecoveryMessage(candidates: EmergencyRecoveryCandidate[]) {
    const totalMessages = candidates.reduce((sum, candidate) => sum + (candidate.record.messages?.length ?? 0), 0);
    return language.emergencyBackup.recoveryPrompt
        .replace('{0}', candidates.length.toString())
        .replace('{1}', totalMessages.toString());
}

function buildRecoveredChat(record: EmergencyBackupRecord, baseChat?: Chat): Chat | null {
    const canUseBase = !!baseChat && (
        !record.baseFingerprint ||
        getEmergencyChatFingerprint(baseChat) === record.baseFingerprint
    );
    const baseMessages = canUseBase && record.messageStart > 0
        ? safeStructuredClone(baseChat?.message ?? []).slice(0, record.messageStart)
        : [];
    const messages = [
        ...baseMessages,
        ...safeStructuredClone(record.messages ?? []),
    ] as Chat['message'];

    return {
        ...safeStructuredClone(record.chatMeta),
        message: messages,
    } as Chat;
}

function getRecoveredChatName(record: EmergencyBackupRecord) {
    const baseName = record.chatName || language.emergencyBackup.untitledChat;
    const date = new Date(record.savedAt).toLocaleString();
    return `${baseName} (${language.emergencyBackup.recoveredChatSuffix} ${date})`;
}
