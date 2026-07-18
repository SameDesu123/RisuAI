import * as fflate from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_CHARX_ENTRY_SIZE_BYTES } from './charXImportLimits'

const mocks = vi.hoisted(() => ({
    saveAsset: vi.fn<(data: Uint8Array) => Promise<string>>()
}))

vi.mock('../globalApi.svelte', () => ({
    AppendableBuffer: class AppendableBuffer {
        chunks: Uint8Array[] = []

        append(data: Uint8Array) {
            this.chunks.push(data.slice())
        }

        get buffer() {
            const size = this.chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
            const result = new Uint8Array(size)
            let offset = 0
            for(const chunk of this.chunks){
                result.set(chunk, offset)
                offset += chunk.byteLength
            }
            return result
        }
    },
    saveAsset: mocks.saveAsset
}))

vi.mock('../util', () => ({
    asBuffer: (data: Uint8Array) => data.buffer,
    Semaphore: class Semaphore {
        async acquire() {}
        release() {}
    },
    sleep: async () => {}
}))

vi.mock('../alert', () => ({
    alertStore: { set: vi.fn() }
}))

vi.mock('../parser/parser.svelte', () => ({
    hasher: vi.fn(async () => 'hash')
}))

vi.mock('../characterCards', () => ({
    hubURL: ''
}))

import { CharXImporter } from './processzip'

const encoder = new TextEncoder()

function setEntryOriginalSize(zip: Uint8Array, targetName: string, originalSize: number) {
    const result = zip.slice()
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength)
    let offset = 0

    while(view.getUint32(offset, true) === 0x04034b50){
        const compressedSize = view.getUint32(offset + 18, true)
        const fileNameLength = view.getUint16(offset + 26, true)
        const extraLength = view.getUint16(offset + 28, true)
        const fileNameStart = offset + 30
        const fileName = new TextDecoder().decode(result.subarray(fileNameStart, fileNameStart + fileNameLength))
        if(fileName === targetName){
            view.setUint32(offset + 22, originalSize, true)
            return result
        }
        offset = fileNameStart + fileNameLength + extraLength + compressedSize
    }

    throw new Error(`ZIP entry ${targetName} not found`)
}

describe('CharXImporter entry size handling', () => {
    beforeEach(() => {
        mocks.saveAsset.mockReset()
        mocks.saveAsset.mockResolvedValue('assets/hash.png')
    })

    it('excludes a known oversized asset without rejecting the card import', async () => {
        const zip = fflate.zipSync({
            'large.png': new Uint8Array([1]),
            'card.json': encoder.encode('{"spec":"chara_card_v3"}')
        }, { level: 0 })
        const importer = new CharXImporter()

        await importer.parse(setEntryOriginalSize(zip, 'large.png', MAX_CHARX_ENTRY_SIZE_BYTES))
        await importer.done()

        expect(importer.excludedFiles).toEqual(['large.png'])
        expect(importer.cardData).toBe('{"spec":"chara_card_v3"}')
        expect(mocks.saveAsset).not.toHaveBeenCalled()
    })

    it('allows a zero-byte asset', async () => {
        const zip = fflate.zipSync({
            'empty.png': new Uint8Array(0),
            'card.json': encoder.encode('{"spec":"chara_card_v3"}')
        }, { level: 0 })
        const importer = new CharXImporter()

        await importer.parse(zip)
        await importer.done()

        expect(importer.excludedFiles).toEqual([])
        expect(mocks.saveAsset).toHaveBeenCalledWith(new Uint8Array(0))
        expect(importer.assets['empty.png']).toBe('assets/hash.png')
    })

    it('drains already-started asset saves before rejecting oversized metadata', async () => {
        let releaseSave: (assetId: string) => void
        mocks.saveAsset.mockImplementation(() => new Promise((resolve) => {
            releaseSave = resolve
        }))
        const zip = fflate.zipSync({
            'asset.png': new Uint8Array([1]),
            'card.json': encoder.encode('{}')
        }, { level: 0 })
        const importer = new CharXImporter()
        let parseSettled = false

        const parsePromise = importer
            .parse(setEntryOriginalSize(zip, 'card.json', MAX_CHARX_ENTRY_SIZE_BYTES))
            .finally(() => {
                parseSettled = true
            })

        await vi.waitFor(() => expect(mocks.saveAsset).toHaveBeenCalledOnce())
        expect(parseSettled).toBe(false)

        releaseSave!('assets/hash.png')
        await expect(parsePromise).rejects.toThrow('CharX card.json exceeds the 50 MB import limit')
        await expect(importer.done()).rejects.toThrow('CharX card.json exceeds the 50 MB import limit')
        expect(importer.excludedFiles).toContain('card.json')
    })
})
