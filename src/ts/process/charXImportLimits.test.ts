import { describe, expect, it } from 'vitest'
import {
    CharXEntrySizeGuard,
    MAX_CHARX_ENTRY_SIZE_BYTES,
    createCharXMetadataSizeError,
    findReferencedExcludedCharXAssets,
    isKnownCharXEntryTooLarge
} from './charXImportLimits'

describe('CharX entry size limits', () => {
    it('allows unknown and zero-byte entries while rejecting known entries at the limit', () => {
        expect(isKnownCharXEntryTooLarge(undefined)).toBe(false)
        expect(isKnownCharXEntryTooLarge(0)).toBe(false)
        expect(isKnownCharXEntryTooLarge(MAX_CHARX_ENTRY_SIZE_BYTES - 1)).toBe(false)
        expect(isKnownCharXEntryTooLarge(MAX_CHARX_ENTRY_SIZE_BYTES)).toBe(true)
        expect(isKnownCharXEntryTooLarge(MAX_CHARX_ENTRY_SIZE_BYTES + 1)).toBe(true)
    })

    it('rejects an unknown-size entry as soon as accumulated chunks reach the limit', () => {
        const guard = new CharXEntrySizeGuard()

        expect(guard.tryAccept(0)).toBe(true)
        expect(guard.tryAccept(MAX_CHARX_ENTRY_SIZE_BYTES - 2)).toBe(true)
        expect(guard.tryAccept(1)).toBe(true)
        expect(guard.tryAccept(1)).toBe(false)
        expect(guard.excluded).toBe(true)
        expect(guard.tryAccept(0)).toBe(false)
    })

    it('reports oversized required metadata by filename', () => {
        expect(createCharXMetadataSizeError('card.json').message).toBe(
            'CharX card.json exceeds the 50 MB import limit'
        )
        expect(createCharXMetadataSizeError('module.risum').message).toBe(
            'CharX module.risum exceeds the 50 MB import limit'
        )
    })

    it('only reports excluded files that the card actually references', () => {
        expect(findReferencedExcludedCharXAssets(
            ['large.png', 'unused.bin'],
            [
                { uri:'__asset:large.png' },
                { uri:'embeded://voice.wav' },
                { uri:'https://example.com/external.png' }
            ]
        )).toEqual(['large.png'])
    })
})
