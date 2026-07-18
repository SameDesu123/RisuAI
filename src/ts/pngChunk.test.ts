import { describe, expect, it, vi } from 'vitest'

vi.mock('./globalApi.svelte', () => ({
    AppendableBuffer: class AppendableBuffer {},
    VirtualWriter: class VirtualWriter {}
}))
vi.mock('./util', () => ({
    blobToUint8Array: vi.fn()
}))

import { PngChunk } from './pngChunk'

const encoder = new TextEncoder()

function makeChunk(type: string, data: Uint8Array): Uint8Array {
    const result = new Uint8Array(12 + data.length)
    const view = new DataView(result.buffer)
    view.setUint32(0, data.length)
    result.set(encoder.encode(type), 4)
    result.set(data, 8)
    return result
}

function makeTextPng(key: string, value: string): Uint8Array {
    const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    const text = encoder.encode(`${key}\0${value}`)
    const textChunk = makeChunk('tEXt', text)
    const endChunk = makeChunk('IEND', new Uint8Array(0))
    const result = new Uint8Array(signature.length + textChunk.length + endChunk.length)
    result.set(signature)
    result.set(textChunk, signature.length)
    result.set(endChunk, signature.length + textChunk.length)
    return result
}

describe('PngChunk.readGenerator raw text mode', () => {
    it('returns tEXt values as bytes without changing the default string mode', async () => {
        const key = 'chara-ext-asset_0'
        const value = 'AAECA/7/'
        const png = makeTextPng(key, value)

        const rawChunks = []
        for await(const chunk of PngChunk.readGenerator(png, { rawText: true })){
            if('key' in chunk){
                rawChunks.push(chunk)
            }
        }
        expect(rawChunks).toEqual([{
            key,
            value: '',
            rawValue: encoder.encode(value)
        }])

        const stringChunks = []
        for await(const chunk of PngChunk.readGenerator(png)){
            if('key' in chunk){
                stringChunks.push(chunk)
            }
        }
        expect(stringChunks).toEqual([{
            key,
            value,
            rawValue: undefined
        }])
    })
})
