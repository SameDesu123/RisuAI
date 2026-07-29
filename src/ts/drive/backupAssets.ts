import {
    getCharactersForAssetReferenceScan,
    type ColdStoragePayloadSnapshot
} from "../process/coldstorageData"
import type { Database } from "../storage/database.svelte"

export type BackupAssetInfo = {
    charName: string
    assetName: string
}

export async function tryReadBackupAsset<T>(reader: () => Promise<T | null | undefined>): Promise<T | undefined> {
    try {
        return (await reader()) ?? undefined
    }
    catch {
        return undefined
    }
}

export function collectPartialCharacterBackupAssets(
    characters: Database['characters'],
    coldStorageSnapshot: ColdStoragePayloadSnapshot,
    allowedUnavailableColdStorageKeys: Iterable<string> = [],
): Map<string, BackupAssetInfo> {
    const assets = new Map<string, BackupAssetInfo>()
    const referenceCharacters = getCharactersForAssetReferenceScan(
        { characters },
        coldStorageSnapshot,
        allowedUnavailableColdStorageKeys,
    )

    for (const character of referenceCharacters) {
        const charName = character.name ?? 'Unknown Character'
        if (character.image) {
            assets.set(character.image, { charName, assetName: 'Profile Image' })
        }
        if (character.imageThumbnail) {
            assets.set(character.imageThumbnail, { charName, assetName: 'Profile Thumbnail' })
        }
    }

    return assets
}
