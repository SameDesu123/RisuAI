import { BaseDirectory, exists, mkdir, readDir, readFile, remove, rename, writeFile } from "@tauri-apps/plugin-fs";
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
import { loadDatabaseBlockDatabase } from "./databaseBlockReader";

const databaseManifestKey = "database/database.bin";

function parentDir(path: string) {
    const index = path.lastIndexOf("/");
    return index === -1 ? "" : path.slice(0, index);
}

export function createAutoDatabaseBlockStorage(storage: DatabaseBlockStorageAdapter) {
    return storage;
}

export function createTauriDatabaseBlockStorage(): DatabaseBlockStorageAdapter {
    async function listFiles(directory: string): Promise<string[]> {
        if (!await exists(directory, { baseDir: BaseDirectory.AppData })) {
            return [];
        }
        const files: string[] = [];
        for (const entry of await readDir(directory, { baseDir: BaseDirectory.AppData })) {
            const key = `${directory}/${entry.name}`;
            if (entry.isDirectory) {
                files.push(...await listFiles(key));
            }
            else {
                files.push(key);
            }
        }
        return files;
    }

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
        async setItemAtomic(key: string, value: Uint8Array) {
            const directory = parentDir(key);
            if (directory) {
                await mkdir(directory, { recursive: true, baseDir: BaseDirectory.AppData });
            }
            const temporaryKey = `${key}.tmp-${crypto.randomUUID()}`;
            try {
                await writeFile(temporaryKey, value, { baseDir: BaseDirectory.AppData });
                await rename(temporaryKey, key, {
                    oldPathBaseDir: BaseDirectory.AppData,
                    newPathBaseDir: BaseDirectory.AppData,
                });
            } catch (error) {
                if (await exists(temporaryKey, { baseDir: BaseDirectory.AppData })) {
                    await remove(temporaryKey, { baseDir: BaseDirectory.AppData });
                }
                throw error;
            }
        },
        async keys() {
            return await listFiles("database/blocks/v2");
        },
        async removeItem(key: string) {
            if (await exists(key, { baseDir: BaseDirectory.AppData })) {
                await remove(key, { baseDir: BaseDirectory.AppData });
            }
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

export async function decodeStoredDatabaseBytes(
    data: Uint8Array,
    storage: DatabaseBlockStorageAdapter,
    decodeLegacy: (data: Uint8Array) => Promise<Database>,
) {
    if (!isDatabaseBlockManifest(data)) {
        return await decodeLegacy(data);
    }
    return await loadDatabaseBlockDatabase(
        decodeDatabaseBlockManifest(data),
        storage,
    );
}

export async function saveDatabaseBlockDatabase(
    db: Database,
    storage: DatabaseBlockStorageAdapter,
    changes?: DatabaseBlockSaveChangeSet,
    previous?: DatabaseBlockManifest | null,
) {
    const current = previous === undefined
        ? await readDatabaseBlockManifest(storage) ?? undefined
        : previous ?? undefined;
    const manifest = await createDatabaseBlockManifest(db, storage, current, changes);
    const encoded = encodeDatabaseBlockManifest(manifest);

    // Payload blocks are immutable and are written by createDatabaseBlockManifest first.
    // Publishing the manifest last keeps the previously committed generation readable.
    if (storage.setItemAtomic) {
        await storage.setItemAtomic(databaseManifestKey, encoded);
    }
    else {
        await storage.setItem(databaseManifestKey, encoded);
    }
    return { encoded, manifest };
}
