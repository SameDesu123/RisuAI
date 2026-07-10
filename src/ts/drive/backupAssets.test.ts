import { describe, expect, it, vi } from 'vitest'

import { tryReadBackupAsset } from './backupAssets'

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
})
