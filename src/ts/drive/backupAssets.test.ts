import { describe, expect, it, vi } from 'vitest'

import { collectPartialCharacterBackupAssets, tryReadBackupAsset } from './backupAssets'

describe('tryReadBackupAsset', () => {
    it('returns available asset data', async () => {
        const data = new Uint8Array([1, 2, 3])

        await expect(tryReadBackupAsset(async () => data)).resolves.toBe(data)
    })

    it('returns undefined when an asset is missing', async () => {
        await expect(tryReadBackupAsset(async () => null)).resolves.toBeUndefined()
    })

    it('returns undefined when reading an asset fails', async () => {
        const reader = vi.fn().mockRejectedValue(new Error('missing asset'))

        await expect(tryReadBackupAsset(reader)).resolves.toBeUndefined()
        expect(reader).toHaveBeenCalledOnce()
    })

    it('collects partial-backup thumbnails from the validated cold snapshot', () => {
        const key = '11111111-1111-1111-1111-111111111111'
        const assets = collectPartialCharacterBackupAssets([{
            type: 'character',
            chaId: 'cold-character',
            name: 'Cold Character',
            coldstorage: key,
            image: 'assets/profile.png',
            imageThumbnail: 'assets/live-thumbnail.webp',
            chats: [],
        }] as any, {
            payloads: [{
                key,
                value: {
                    character: {
                        type: 'character',
                        chaId: 'cold-character',
                        name: 'Cold Character',
                        image: 'assets/profile.png',
                        imageThumbnail: 'assets/cold-thumbnail.webp',
                        chats: [],
                    },
                },
            }],
            missingKeys: [],
            invalidKeys: [],
        })

        expect(Array.from(assets.keys())).toEqual([
            'assets/profile.png',
            'assets/live-thumbnail.webp',
            'assets/cold-thumbnail.webp',
        ])
    })

    it('keeps live partial-backup assets after an explicitly accepted missing cold payload', () => {
        const key = '11111111-1111-1111-1111-111111111111'
        const assets = collectPartialCharacterBackupAssets([{
            type: 'character',
            chaId: 'cold-character',
            name: 'Cold Character',
            coldstorage: key,
            image: 'assets/profile.png',
            imageThumbnail: 'assets/live-thumbnail.webp',
            chats: [],
        }] as any, {
            payloads: [],
            missingKeys: [key],
            invalidKeys: [],
        }, [key])

        expect(Array.from(assets.keys())).toEqual([
            'assets/profile.png',
            'assets/live-thumbnail.webp',
        ])
    })
})
