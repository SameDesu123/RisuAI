import { describe, expect, it } from 'vitest'
import {
    decodeRemoteSaveMeta,
    encodeRemoteSaveMeta,
    getRemoteSaveCleanupAction,
    getRemoteSaveMetaPath,
    getRemoteSavePayloadBlockName,
    remoteSaveCleanupGraceMs,
} from './remoteSaveCleanup'
import { getChatBlockName, getRemoteSaveBlockNames } from './risuSaveBlocks'
import type { Database } from './database.svelte'

function makeDb():Pick<Database, 'characters'>{
    return {
        characters: [{
            chaId: 'char-1',
            chats: [{ id: 'chat-1' }, { id: 'chat-2' }],
        }, {
            chaId: 'char-2',
            chats: [{ id: 'chat-3' }],
        }] as any
    }
}

describe('remote save cleanup helpers', () => {
    it('uses the same chat block names as save encoding', () => {
        const blockNames = getRemoteSaveBlockNames(makeDb())

        expect(blockNames.has('char-1')).toBe(true)
        expect(blockNames.has(getChatBlockName('char-1', 'chat-1'))).toBe(true)
        expect(blockNames.has(getChatBlockName('char-2', 'chat-3'))).toBe(true)
    })

    it('keeps live character and chat payloads', () => {
        const activeBlockNames = getRemoteSaveBlockNames(makeDb())
        const chatBlockName = getChatBlockName('char-1', 'chat-1')

        expect(getRemoteSaveCleanupAction({
            path: 'char-1.local.bin',
            activeBlockNames,
        })).toBe('keep')
        expect(getRemoteSaveCleanupAction({
            path: `remotes/${chatBlockName}.local.bin`,
            activeBlockNames,
        })).toBe('keep')
    })

    it('creates meta for a newly orphaned payload before deleting it', () => {
        const activeBlockNames = getRemoteSaveBlockNames(makeDb())

        expect(getRemoteSaveCleanupAction({
            path: 'remotes/deleted.local.bin',
            activeBlockNames,
            metaExists: false,
        })).toBe('create-meta')
        expect(getRemoteSaveMetaPath('remotes/deleted.local.bin')).toBe('remotes/deleted.local.bin.meta')
    })

    it('deletes stale orphan payloads after the grace period', () => {
        const activeBlockNames = getRemoteSaveBlockNames(makeDb())
        const now = 10_000_000

        expect(getRemoteSaveCleanupAction({
            path: 'remotes/deleted.local.bin',
            activeBlockNames,
            metaExists: true,
            metaLastUsed: now - remoteSaveCleanupGraceMs - 1,
            now,
        })).toBe('delete')
    })

    it('ignores unrelated entries and refreshes malformed meta safely', () => {
        const activeBlockNames = getRemoteSaveBlockNames(makeDb())

        expect(getRemoteSavePayloadBlockName('remotes/not-a-payload.txt')).toBeNull()
        expect(getRemoteSaveCleanupAction({
            path: 'remotes/not-a-payload.txt',
            activeBlockNames,
        })).toBe('ignore')
        expect(decodeRemoteSaveMeta(new TextEncoder().encode('{nope'))).toBeNull()
        expect(decodeRemoteSaveMeta(encodeRemoteSaveMeta(123))).toEqual({ lastUsed: 123 })
        expect(getRemoteSaveCleanupAction({
            path: 'remotes/deleted.local.bin',
            activeBlockNames,
            metaExists: true,
            metaLastUsed: null,
        })).toBe('create-meta')
    })
})
