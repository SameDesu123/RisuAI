export async function tryReadBackupAsset<T>(reader: () => Promise<T | null | undefined>): Promise<T | undefined> {
    try {
        return (await reader()) ?? undefined
    }
    catch {
        return undefined
    }
}
