import { isNodeServer } from "../platform"
import { DBState } from "../stores.svelte"
import { forageStorage, saving } from "../globalApi.svelte"
import { getDatabase, type Database, type character, type groupChat } from "./database.svelte"
import { sleep } from "../util"

const SPLIT_VERSION = 1
const SPLIT_PREFIX = "database/split/v1"
const META_KEY = `${SPLIT_PREFIX}/meta.json`
const ROOT_KEY = `${SPLIT_PREFIX}/root.bin`
const CHARACTER_PREFIX = `${SPLIT_PREFIX}/characters`
const BLOCK_HEADER = "RISU_NODE_SPLIT_V1\0"

export type NodeSplitMeta = {
    type: 'risu-node-split-save'
    version: 1
    createdAt: number
    updatedAt: number
    rootKey: string
}

export type NodeSplitCharacterStub = {
    __nodeSplitStub: true
    chaId: string
    type: 'character' | 'group'
    name: string
    image?: string
    chatPage: number
    chatCount: number
    lastInteraction?: number
    tags?: string[]
    trashTime?: number
    coldstorage?: string
    chats: []
    chatFolders: []
    globalLore: []
    emotionImages: []
    customscript: []
    viewScreen: 'none'
    firstMessage: string
    ccAssets?: unknown[]
    [key: string]: unknown
}

type NodeSplitRoot = Omit<Database, 'characters'> & {
    characters: NodeSplitCharacterStub[]
    __nodeSplitSave?: {
        version: 1
        migratedFromMonolith?: boolean
        lastFullSaveAt?: number
    }
}

type NodeSplitSaveOptions = {
    changedCharacterIds?: string[]
    writeCompatibilitySnapshot?: boolean
    migratedFromMonolith?: boolean
}

let migrationInFlight = false
let saveLoopStarted = false
let writeChain: Promise<void> = Promise.resolve()

function debugTime(label: string, startedAt: number) {
    console.debug('[node-split-save]', label, `${(performance.now() - startedAt).toFixed(1)}ms`)
}

function characterKey(chaId: string) {
    return `${CHARACTER_PREFIX}/${encodeURIComponent(chaId)}.bin`
}

function toBytes(value: Uint8Array | ArrayBuffer | Buffer | null | undefined): Uint8Array | null {
    if (!value) {
        return null
    }
    if (value instanceof Uint8Array) {
        return value
    }
    return new Uint8Array(value)
}

function parseJsonBlock<T>(raw: Uint8Array): T {
    return JSON.parse(new TextDecoder().decode(raw)) as T
}

function encodePlainJson(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value))
}

export function isNodeSplitCharacterStub(value: unknown): value is NodeSplitCharacterStub {
    return !!value && typeof value === 'object' && (value as NodeSplitCharacterStub).__nodeSplitStub === true
}

async function encodeNodeSplitBlock(value: unknown): Promise<Uint8Array> {
    const header = new TextEncoder().encode(BLOCK_HEADER)
    const body = new TextEncoder().encode(JSON.stringify(value))
    const out = new Uint8Array(header.length + body.length)
    out.set(header, 0)
    out.set(body, header.length)
    return out
}

async function decodeNodeSplitBlock<T>(data: Uint8Array | Buffer): Promise<T> {
    const bytes = toBytes(data)
    if (!bytes) {
        throw new Error('Empty node split block')
    }
    const header = new TextEncoder().encode(BLOCK_HEADER)
    for (let i = 0; i < header.length; i++) {
        if (bytes[i] !== header[i]) {
            throw new Error('Invalid node split block header')
        }
    }
    const json = new TextDecoder().decode(bytes.slice(header.length))
    return JSON.parse(json) as T
}

function makeCharacterStub(char: character | groupChat | NodeSplitCharacterStub): NodeSplitCharacterStub {
    if (isNodeSplitCharacterStub(char)) {
        return {
            ...char,
            chats: [],
            chatFolders: [],
            globalLore: [],
            emotionImages: [],
            customscript: []
        }
    }

    const maybeCharacter = char as character
    return {
        __nodeSplitStub: true,
        chaId: char.chaId,
        type: char.type ?? 'character',
        name: char.name ?? '',
        image: char.image ?? '',
        chatPage: char.chatPage ?? 0,
        chatCount: Array.isArray(char.chats) ? char.chats.length : 0,
        lastInteraction: char.lastInteraction,
        tags: maybeCharacter.tags,
        trashTime: char.trashTime,
        coldstorage: char.coldstorage,
        ccAssets: maybeCharacter.ccAssets,
        chats: [],
        chatFolders: [],
        globalLore: [],
        emotionImages: [],
        customscript: [],
        viewScreen: 'none',
        firstMessage: ''
    }
}

function buildRoot(db: Database, options: NodeSplitSaveOptions = {}): NodeSplitRoot {
    const root = JSON.parse(JSON.stringify(db)) as NodeSplitRoot
    root.characters = (db.characters ?? []).map(makeCharacterStub)
    root.__nodeSplitSave = {
        version: SPLIT_VERSION,
        migratedFromMonolith: options.migratedFromMonolith ?? root.__nodeSplitSave?.migratedFromMonolith,
        lastFullSaveAt: Date.now()
    }
    return root
}

function getWritableCharacters(db: Database, changedCharacterIds?: string[]) {
    const changedSet = changedCharacterIds ? new Set(changedCharacterIds.filter(Boolean)) : null
    return (db.characters ?? []).filter((char) => {
        if (!char || isNodeSplitCharacterStub(char)) {
            return false
        }
        if (!changedSet) {
            return true
        }
        return changedSet.has(char.chaId)
    }) as (character | groupChat)[]
}

function enqueueWrite(label: string, task: () => Promise<void>) {
    writeChain = writeChain
        .catch((error) => {
            console.warn('[node-split-save] previous write failed', error)
        })
        .then(async () => {
            const startedAt = performance.now()
            await task()
            debugTime(label, startedAt)
        })
    return writeChain
}

export async function loadNodeSplitRoot(): Promise<Database | null> {
    if (!isNodeServer || forageStorage.isAccount) {
        return null
    }

    try {
        const metaStartedAt = performance.now()
        const metaRaw = toBytes(await forageStorage.getItem(META_KEY))
        debugTime('split meta read', metaStartedAt)
        if (!metaRaw) {
            return null
        }

        const meta = parseJsonBlock<NodeSplitMeta>(metaRaw)
        if (meta.type !== 'risu-node-split-save' || meta.version !== SPLIT_VERSION || !meta.rootKey) {
            return null
        }

        const rootReadStartedAt = performance.now()
        const rootRaw = toBytes(await forageStorage.getItem(meta.rootKey))
        debugTime('split root read', rootReadStartedAt)
        if (!rootRaw) {
            return null
        }

        const rootDecodeStartedAt = performance.now()
        const root = await decodeNodeSplitBlock<NodeSplitRoot>(rootRaw)
        debugTime('split root decode', rootDecodeStartedAt)
        if (!Array.isArray(root.characters)) {
            return null
        }

        return root as unknown as Database
    } catch (error) {
        console.warn('[node-split-save] split root unavailable; falling back to monolith', error)
        return null
    }
}

export async function saveNodeSplitDatabase(db: Database, options: NodeSplitSaveOptions = {}): Promise<void> {
    if (!isNodeServer || forageStorage.isAccount) {
        return
    }

    await enqueueWrite('split save write', async () => {
        const now = Date.now()
        const root = buildRoot(db, options)
        const chars = getWritableCharacters(db, options.changedCharacterIds)

        for (const char of chars) {
            await forageStorage.setItem(characterKey(char.chaId), await encodeNodeSplitBlock(char))
        }

        await forageStorage.setItem(ROOT_KEY, await encodeNodeSplitBlock(root))
        await forageStorage.setItem(META_KEY, encodePlainJson({
            type: 'risu-node-split-save',
            version: SPLIT_VERSION,
            createdAt: now,
            updatedAt: now,
            rootKey: ROOT_KEY
        } satisfies NodeSplitMeta))

        if (options.writeCompatibilitySnapshot) {
            console.debug('[node-split-save] compatibility snapshot requested but intentionally skipped for this Node-only split save path')
        }
    })
}

export async function ensureNodeSplitCharacterLoaded(index: number): Promise<void> {
    if (!isNodeServer || forageStorage.isAccount) {
        return
    }

    const char = DBState.db.characters?.[index]
    if (!isNodeSplitCharacterStub(char)) {
        return
    }

    const readStartedAt = performance.now()
    const raw = toBytes(await forageStorage.getItem(characterKey(char.chaId)))
    debugTime('character hydration read', readStartedAt)
    if (!raw) {
        throw new Error(`Missing split character data: ${char.chaId}`)
    }

    const decodeStartedAt = performance.now()
    const loaded = await decodeNodeSplitBlock<character | groupChat>(raw)
    debugTime('character hydration decode', decodeStartedAt)
    if (!loaded || loaded.chaId !== char.chaId) {
        throw new Error(`Invalid split character data: ${char.chaId}`)
    }

    DBState.db.characters[index] = loaded
}

export async function migrateMonolithToNodeSplit(db: Database): Promise<void> {
    if (!isNodeServer || forageStorage.isAccount || migrationInFlight) {
        return
    }

    migrationInFlight = true
    try {
        const startedAt = performance.now()
        await saveNodeSplitDatabase(db, {
            changedCharacterIds: db.characters?.map((char) => char?.chaId).filter(Boolean),
            migratedFromMonolith: true
        })
        debugTime('split migration write', startedAt)
    } finally {
        migrationInFlight = false
    }
}

export function startNodeSplitSaveLoop(): boolean {
    if (!isNodeServer || forageStorage.isAccount || saveLoopStarted) {
        return false
    }
    saveLoopStarted = true

    let changed = false
    let saveTimeout: ReturnType<typeof setTimeout> | null = null

    $effect.root(() => {
        $effect(() => {
            $state.snapshot(DBState.db)
            if (saveTimeout) {
                clearTimeout(saveTimeout)
            }
            saveTimeout = setTimeout(() => {
                changed = true
            }, 500)
        })
    })

    async function loop() {
        await sleep(1000)
        while (true) {
            if (!changed) {
                await sleep(500)
                continue
            }

            changed = false
            saving.state = true
            try {
                await saveNodeSplitDatabase(getDatabase({ snapshot: true }))
            } catch (error) {
                console.error('[node-split-save] save failed', error)
            } finally {
                saving.state = false
            }
        }
    }

    loop()
    return true
}
