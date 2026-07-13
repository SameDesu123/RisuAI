import type { Database } from "./database.svelte";
import type { DatabaseBlockManifest, DatabaseBlockStorageAdapter } from "./databaseBlockFormat";
import { saveDatabaseBlockDatabase } from "./databaseBlockStorage";
import type { SaveDirtySnapshot } from "./saveDirtyTracker";
import { SaveDirtyTracker } from "./saveDirtyTracker";

export async function saveDatabaseBlockSnapshot(
    db: Database,
    storage: DatabaseBlockStorageAdapter,
    dirtyTracker: SaveDirtyTracker,
    snapshot: SaveDirtySnapshot,
    previous?: DatabaseBlockManifest | null,
    afterPublish?: (result: {
        encoded: Uint8Array;
        manifest: DatabaseBlockManifest;
    }) => Promise<void>,
) {
    const result = await saveDatabaseBlockDatabase(db, storage, {
        ...snapshot.toSave,
        root: snapshot.rootVersion !== undefined,
    }, previous);
    await afterPublish?.(result);
    dirtyTracker.ack(snapshot);
    return result;
}
