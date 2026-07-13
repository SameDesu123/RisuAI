import { BaseDirectory, exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import type { Database } from "./database.svelte";
import {
    decodeDatabaseBlockManifest,
    encodeDatabaseBlockManifest,
    isDatabaseBlockManifest,
    type DatabaseBlockManifest,
    type DatabaseBlockStorageAdapter,
} from "./databaseBlockFormat";
import {
    createDatabaseBlockManifest,
    type DatabaseBlockSaveChangeSet,
} from "./databaseBlockWriter";

const databaseManifestKey = "database/database.bin";

function parentDir(path: string) {
    const index = path.lastIndexOf("/");
    return index === -1 ? "" : path.slice(0, index);
}

export function createAutoDatabaseBlockStorage(storage: DatabaseBlockStorageAdapter) {
    return storage;
}

export function createTauriDatabaseBlockStorage(): DatabaseBlockStorageAdapter {
    return {
        async getItem(key: string) {
            if (!await exists(key, { baseDir: BaseDirectory.AppData })) {
                return null;
            }
            return await readFile(key, { baseDir: BaseDirectory.AppData });
        },
        async setItem(key: string, value: Uint8Array) {
            const directory = parentDir(key);
            if (directory) {
                await mkdir(directory, { recursive: true, baseDir: BaseDirectory.AppData });
            }
            await writeFile(key, value, { baseDir: BaseDirectory.AppData });
        },
    };
}

export async function readDatabaseBlockManifest(storage: DatabaseBlockStorageAdapter) {
    const data = await storage.getItem(databaseManifestKey);
    if (!isDatabaseBlockManifest(data)) {
        return null;
    }
    return decodeDatabaseBlockManifest(data!);
}

export async function saveDatabaseBlockDatabase(
    db: Database,
    storage: DatabaseBlockStorageAdapter,
    changes?: DatabaseBlockSaveChangeSet,
    previous?: DatabaseBlockManifest,
) {
    const current = previous ?? await readDatabaseBlockManifest(storage) ?? undefined;
    const manifest = await createDatabaseBlockManifest(db, storage, current, changes);
    const encoded = encodeDatabaseBlockManifest(manifest);

    // Payload blocks are immutable and are written by createDatabaseBlockManifest first.
    // Publishing the manifest last keeps the previously committed generation readable.
    await storage.setItem(databaseManifestKey, encoded);
    return { encoded, manifest };
}
