import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat, Database } from './database.svelte'
import { decodeRisuSave, RisuSaveEncoder, type toSaveType } from './risuSave'

const mocks = vi.hoisted(() => {
    const cacheStore = new Map<string, unknown>()
    const cacheSetItem = vi.fn(async (key: string, value: unknown) => {
        cacheStore.set(key, value)
    })
    return {
        cacheStore,
        cacheSetItem,
    }
})

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => mocks.cacheStore.get(key) ?? null),
            setItem: mocks.cacheSetItem,
            removeItem: vi.fn(async (key: string) => {
                mocks.cacheStore.delete(key)
            }),
            keys: vi.fn(async () => [...mocks.cacheStore.keys()]),
        }),
    },
}))

vi.mock('./database.svelte', () => ({
    getDatabase: () => ({
        enableRemoteSaving: false,
    }),
    presetTemplate: {
        name: 'Default',
    },
}))

vi.mock('../globalApi.svelte', () => ({
    forageStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        keys: vi.fn(async () => []),
    },
}))

vi.mock('src/ts/platform', () => ({
    isNodeServer: false,
    isTauri: false,
}))

const RISU_SAVE_HEADER = new TextEncoder().encode('RISUSAVE\0')
const ROOT = 1
const CHARACTER_WITH_CHAT = 2
const CHAT = 3

function makeChat(id: string, data: string): Chat {
    return {
        id,
        name: id,
        note: '',
        localLore: [],
        message: [{
            role: 'user',
            data,
            chatId: `message-${id}`,
        }],
    }
}

function makeDb(): Database {
    return {
        characters: [{
            type: 'character',
            chaId: 'char-1',
            name: 'Character',
            chats: [
                makeChat('chat-1', 'hello'),
                makeChat('chat-2', 'world'),
            ],
            chatFolders: [],
            chatPage: 0,
            firstMessage: '',
            desc: '',
            notes: '',
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
        }],
        botPresets: [],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
    } as unknown as Database
}

function emptyToSave(overrides: Partial<toSaveType> = {}): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
        ...overrides,
    }
}

function makeBlock(type: number, name: string, data: string) {
    const nameBuf = new TextEncoder().encode(name)
    const dataBuf = new TextEncoder().encode(data)
    const lengthBuf = new ArrayBuffer(4)
    new Uint32Array(lengthBuf)[0] = dataBuf.length

    const block = new Uint8Array(2 + 1 + nameBuf.length + 4 + dataBuf.length)
    block.set(new Uint8Array([type, 0]), 0)
    block.set(new Uint8Array([nameBuf.length]), 2)
    block.set(nameBuf, 3)
    block.set(new Uint8Array(lengthBuf), 3 + nameBuf.length)
    block.set(dataBuf, 7 + nameBuf.length)
    return block
}

function makeRisuSave(blocks: Uint8Array[]) {
    const total = RISU_SAVE_HEADER.length + blocks.reduce((sum, block) => sum + block.length, 0)
    const save = new Uint8Array(total)
    let offset = 0
    save.set(RISU_SAVE_HEADER, offset)
    offset += RISU_SAVE_HEADER.length
    for(const block of blocks){
        save.set(block, offset)
        offset += block.length
    }
    return save
}

function parseBlocks(data: ArrayBuffer | Uint8Array) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    const blocks: { type: number; name: string; content: string }[] = []
    let offset = RISU_SAVE_HEADER.length
    while(offset < bytes.length){
        const type = bytes[offset]
        offset += 2
        const nameLength = bytes[offset]
        offset += 1
        const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const lengthBuf = new ArrayBuffer(4)
        new Uint8Array(lengthBuf).set(bytes.subarray(offset, offset + 4))
        const length = new Uint32Array(lengthBuf)[0]
        offset += 4
        const content = new TextDecoder().decode(bytes.subarray(offset, offset + length))
        offset += length
        blocks.push({ type, name, content })
    }
    return blocks
}

function chatBlocks(data: ArrayBuffer | Uint8Array) {
    return parseBlocks(data).filter((block) => block.type === CHAT).map((block) => JSON.parse(block.content))
}

describe('RisuSave chat blocks', () => {
    beforeEach(() => {
        mocks.cacheStore.clear()
        mocks.cacheSetItem.mockClear()
    })

    it('decodes legacy full-character blocks', async () => {
        const db = makeDb()
        const save = makeRisuSave([
            makeBlock(ROOT, 'root', JSON.stringify({})),
            makeBlock(CHARACTER_WITH_CHAT, 'char-1', JSON.stringify(db.characters[0])),
        ])

        const decoded = await decodeRisuSave(save)

        expect(decoded.characters[0].chaId).toBe('char-1')
        expect(decoded.characters[0].chats.map((chat) => chat.message[0].data)).toEqual(['hello', 'world'])
    })

    it('round-trips split character metadata and chat blocks', async () => {
        const db = makeDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)
        const encoded = encoder.encode()
        expect(encoded).not.toBeNull()

        const blocks = parseBlocks(encoded!)
        const characterBlock = blocks.find((block) => block.name === 'char-1')
        expect(JSON.parse(characterBlock!.content).chats).toEqual([{ id: 'chat-1' }, { id: 'chat-2' }])

        const decoded = await decodeRisuSave(new Uint8Array(encoded!))
        expect(decoded.characters[0].chats.map((chat) => chat.message[0].data)).toEqual(['hello', 'world'])
    })

    it('re-encodes only the changed chat on chat-only saves', async () => {
        const db = makeDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)
        mocks.cacheSetItem.mockClear()

        db.characters[0].chats[0].message[0].data = 'changed'
        await encoder.set(db, emptyToSave({
            chat: [['char-1', 'chat-1']],
        }))

        const changedChatIds = mocks.cacheSetItem.mock.calls
            .map(([, value]) => value as { type: number; data: string })
            .filter((value) => value.type === CHAT)
            .map((value) => JSON.parse(value.data).chatId)

        expect(changedChatIds).toEqual(['chat-1'])
    })

    it('removes stale chat blocks after chat deletion', async () => {
        const db = makeDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)

        db.characters[0].chats = [db.characters[0].chats[0]]
        await encoder.set(db, emptyToSave({
            character: ['char-1'],
        }))
        const encoded = encoder.encode()
        expect(encoded).not.toBeNull()

        expect(chatBlocks(encoded!).map((block) => block.chatId)).toEqual(['chat-1'])
        const decoded = await decodeRisuSave(new Uint8Array(encoded!))
        expect(decoded.characters[0].chats.map((chat) => chat.id)).toEqual(['chat-1'])
    })
})
