import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "./database.svelte";
import type { DatabaseBlockStorageAdapter } from "./databaseBlockFormat";

const fsMocks = vi.hoisted(() => ({
    exists: vi.fn(),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
    BaseDirectory: { AppData: "AppData" },
    ...fsMocks,
}));

import {
    createTauriDatabaseBlockStorage,
    readDatabaseBlockManifest,
    saveDatabaseBlockDatabase,
} from "./databaseBlockStorage";

class RecordingStorage implements DatabaseBlockStorageAdapter {
    values = new Map<string, Uint8Array>();
    writes: string[] = [];
    failPrefix = "";
    failReadKey = "";

    async getItem(key: string) {
        if (key === this.failReadKey) {
            throw new Error("storage read failed");
        }
        return this.values.get(key) ?? null;
    }

    async setItem(key: string, value: Uint8Array) {
        this.writes.push(key);
        if (this.failPrefix && key.startsWith(this.failPrefix)) {
            throw new Error("storage write failed");
        }
        this.values.set(key, value);
    }
}

function createDatabase(): Database {
    return {
        characters: [],
        botPresets: [{ name: "Default" }],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        language: "en",
    } as unknown as Database;
}

describe("databaseBlockStorage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("publishes the manifest after every payload block", async () => {
        const storage = new RecordingStorage();
        const result = await saveDatabaseBlockDatabase(createDatabase(), storage);

        expect(storage.writes.at(-1)).toBe("database/database.bin");
        expect(storage.writes.slice(0, -1).every((key) => key.startsWith("database/blocks/v2/"))).toBe(true);
        expect(await readDatabaseBlockManifest(storage)).toEqual(result.manifest);
    });

    it("keeps the previous manifest when a payload write fails", async () => {
        const storage = new RecordingStorage();
        const db = createDatabase();
        const first = await saveDatabaseBlockDatabase(db, storage);
        const published = storage.values.get("database/database.bin");

        db.modules = [{ name: "Changed" }] as any;
        storage.writes = [];
        storage.failPrefix = "database/blocks/v2/components/modules";
        await expect(saveDatabaseBlockDatabase(db, storage, { modules: true }, first.manifest))
            .rejects.toThrow("storage write failed");

        expect(storage.writes).not.toContain("database/database.bin");
        expect(storage.values.get("database/database.bin")).toBe(published);
    });

    it("can republish a recovered generation without reading a broken primary manifest", async () => {
        const storage = new RecordingStorage();
        storage.failReadKey = "database/database.bin";

        await expect(saveDatabaseBlockDatabase(createDatabase(), storage, undefined, null)).resolves.toBeTruthy();
        expect(storage.writes.at(-1)).toBe("database/database.bin");
    });

    it("creates Tauri directories and uses AppData file operations", async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        fsMocks.exists.mockResolvedValue(true);
        fsMocks.readFile.mockResolvedValue(bytes);
        const storage = createTauriDatabaseBlockStorage();

        await storage.setItem("database/blocks/v2/root/file.bin", bytes);
        expect(fsMocks.mkdir).toHaveBeenCalledWith("database/blocks/v2/root", {
            recursive: true,
            baseDir: "AppData",
        });
        expect(fsMocks.writeFile).toHaveBeenCalledWith(
            "database/blocks/v2/root/file.bin",
            bytes,
            { baseDir: "AppData" },
        );
        await expect(storage.getItem("database/blocks/v2/root/file.bin")).resolves.toBe(bytes);
    });
});
