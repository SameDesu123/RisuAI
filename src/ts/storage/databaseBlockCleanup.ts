import {
    databaseBlockNamespace,
    type DatabaseBlockManifest,
    type DatabaseBlockStorageAdapter,
} from "./databaseBlockFormat";

export function collectDatabaseBlockKeys(manifest: DatabaseBlockManifest) {
    const keys = new Set<string>([manifest.root.key]);
    for (const ref of Object.values(manifest.components)) {
        keys.add(ref.key);
    }
    for (const ref of Object.values(manifest.characters.refs)) {
        keys.add(ref.key);
    }
    for (const chats of Object.values(manifest.characters.chatRefs)) {
        for (const ref of Object.values(chats.refs)) {
            keys.add(ref.key);
        }
    }
    return keys;
}

export async function cleanupDatabaseBlockGenerations(
    storage: DatabaseBlockStorageAdapter,
    manifests: DatabaseBlockManifest[],
) {
    if (!storage.keys || !storage.removeItem) {
        return [];
    }
    const retained = new Set<string>();
    for (const manifest of manifests) {
        for (const key of collectDatabaseBlockKeys(manifest)) {
            retained.add(key);
        }
    }

    const removed: string[] = [];
    for (const key of await storage.keys()) {
        if (key.startsWith(`${databaseBlockNamespace}/`) && !retained.has(key)) {
            await storage.removeItem(key);
            removed.push(key);
        }
    }
    return removed;
}
