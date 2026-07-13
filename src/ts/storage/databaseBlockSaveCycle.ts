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
) {
    const result = await saveDatabaseBlockDatabase(db, storage, {
        ...snapshot.toSave,
        root: snapshot.rootVersion !== undefined,
    }, previous);
    dirtyTracker.ack(snapshot);
    return result;
}
