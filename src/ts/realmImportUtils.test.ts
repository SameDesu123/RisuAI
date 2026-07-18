import { describe, expect, it, vi } from 'vitest'
import {
    classifyRealmCharacterResponse,
    getRealmResponseError,
    getResponseStreamOrBytes,
    isPendingRealmUpload,
} from './realmImportUtils'

describe('Realm character download helpers', () => {
    it('classifies parameterized and case-insensitive card content types', () => {
        expect(classifyRealmCharacterResponse('application/charx; charset=binary')).toBe('charx')
        expect(classifyRealmCharacterResponse('Application/Zip; Charset=UTF-8')).toBe('charx')
        expect(classifyRealmCharacterResponse('image/png; charset=binary')).toBe('png')
        expect(classifyRealmCharacterResponse('application/json')).toBe('structured')
    })

    it('uses a response stream without buffering it', async () => {
        const body = new ReadableStream<Uint8Array<ArrayBuffer>>()
        const arrayBuffer = vi.fn(async () => new ArrayBuffer(0))

        await expect(getResponseStreamOrBytes({ body, arrayBuffer })).resolves.toBe(body)
        expect(arrayBuffer).not.toHaveBeenCalled()
    })

    it('falls back to bytes when a response has no body stream', async () => {
        const bytes = Uint8Array.from([1, 2, 3])
        const arrayBuffer = vi.fn(async () => bytes.buffer)

        await expect(getResponseStreamOrBytes({ body: null, arrayBuffer })).resolves.toEqual(bytes)
        expect(arrayBuffer).toHaveBeenCalledOnce()
    })

    it('preserves server errors and only identifies uploading 404 responses as pending', () => {
        const message = getRealmResponseError(404, JSON.stringify({ message: 'Card not found, probably the card is still uploading' }))
        expect(message).toBe('Realm download failed (HTTP 404): Card not found, probably the card is still uploading')
        expect(isPendingRealmUpload(404, message)).toBe(true)
        expect(isPendingRealmUpload(500, message)).toBe(false)
        expect(getRealmResponseError(503, '')).toBe('Realm download failed (HTTP 503)')
    })
})
