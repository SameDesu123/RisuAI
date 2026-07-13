import { describe, expect, it } from "vitest";
import type { Database } from "./database.svelte";
import { saveDatabaseBlockSnapshot } from "./databaseBlockSaveCycle";
import type { DatabaseBlockStorageAdapter } from "./databaseBlockFormat";
import { SaveDirtyTracker } from "./saveDirtyTracker";

class MemoryBlockStorage implements DatabaseBlockStorageAdapter {
    values = new Map<string, Uint8Array>();
    failManifest = false;

    async getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    async setItem(key: string, value: Uint8Array) {
        this.values.set(key, value);
    }

    async setItemAtomic(key: string, value: Uint8Array) {
        if (this.failManifest && key === "database/database.bin") {
            throw new Error("manifest publication failed");
        }
        this.values.set(key, value);
    }
}

function createDatabase(): Database {
    return {
        characters: [],
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
    } as unknown as Database;
}

describe("saveDatabaseBlockSnapshot", () => {
    it("acknowledges dirty state only after manifest publication succeeds", async () => {
        const storage = new MemoryBlockStorage();
        const tracker = new SaveDirtyTracker();
        tracker.markRoot();
        const snapshot = tracker.snapshot();
        storage.failManifest = true;

        await expect(saveDatabaseBlockSnapshot(createDatabase(), storage, tracker, snapshot, null))
            .rejects.toThrow("manifest publication failed");
        expect(tracker.hasChanges()).toBe(true);

        storage.failManifest = false;
        await saveDatabaseBlockSnapshot(createDatabase(), storage, tracker, snapshot, null);
        expect(tracker.hasChanges()).toBe(false);
    });

    it("preserves edits made after the in-flight snapshot", async () => {
        const storage = new MemoryBlockStorage();
        const tracker = new SaveDirtyTracker();
        tracker.markRoot();
        const snapshot = tracker.snapshot();
        tracker.markChat("char-1", "chat-1");

        await saveDatabaseBlockSnapshot(createDatabase(), storage, tracker, snapshot, null);

        expect(tracker.snapshot().toSave.chat).toEqual([["char-1", "chat-1"]]);
    });
});
