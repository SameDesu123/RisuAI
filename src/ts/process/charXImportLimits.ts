export const MAX_CHARX_ENTRY_SIZE_BYTES = 50 * 1024 * 1024

export function isKnownCharXEntryTooLarge(originalSize: number|undefined) {
    return originalSize !== undefined && originalSize >= MAX_CHARX_ENTRY_SIZE_BYTES
}

export class CharXEntrySizeGuard {
    #receivedBytes = 0
    #excluded = false

    get excluded() {
        return this.#excluded
    }

    tryAccept(chunkSize: number) {
        if(this.#excluded){
            return false
        }

        if(this.#receivedBytes + chunkSize >= MAX_CHARX_ENTRY_SIZE_BYTES){
            this.#excluded = true
            return false
        }

        this.#receivedBytes += chunkSize
        return true
    }
}

export function createCharXMetadataSizeError(fileName: string) {
    const sizeLimitMb = MAX_CHARX_ENTRY_SIZE_BYTES / 1024 / 1024
    return new Error(`CharX ${fileName} exceeds the ${sizeLimitMb} MB import limit`)
}

export function findReferencedExcludedCharXAssets(
    excludedFiles: string[],
    assets: Array<{ uri:string }> | undefined
) {
    if(!assets?.length || excludedFiles.length === 0){
        return []
    }
    const referencedFiles = new Set(assets.flatMap((asset) => {
        if(asset.uri.startsWith('__asset:')){
            return [asset.uri.slice('__asset:'.length)]
        }
        if(asset.uri.startsWith('embeded://')){
            return [asset.uri.slice('embeded://'.length)]
        }
        return []
    }))
    return excludedFiles.filter((fileName) => referencedFiles.has(fileName))
}
