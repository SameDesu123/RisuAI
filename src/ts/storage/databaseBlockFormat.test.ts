import { describe, expect, it } from "vitest";
import {
    decodeDatabaseBlockManifest,
    encodeDatabaseBlockManifest,
    isDatabaseBlockManifest,
    readDatabaseBlock,
    writeDatabaseBlock,
    type DatabaseBlockManifest,
    type DatabaseBlockStorageAdapter,
} from "./databaseBlockFormat";

class MemoryBlockStorage implements DatabaseBlockStorageAdapter {
    values = new Map<string, Uint8Array>();
    writes: string[] = [];

    async getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    async setItem(key: string, value: Uint8Array) {
        this.writes.push(key);
        this.values.set(key, value);
    }
}

function createManifest(): DatabaseBlockManifest {
    const root = {
        key: "database/blocks/v2/root-deadbeef.bin",
        hash: "deadbeef",
        byteLength: 1,
        updatedAt: 1,
    };
    return {
        kind: "risu-database-block-manifest",
        version: 2,
        updatedAt: 1,
        root,
        components: {},
        characters: {
            order: [],
            refs: {},
            chatRefs: {},
        },
    };
}

describe("databaseBlockFormat", () => {
    it("encodes and decodes a small database manifest", () => {
        const manifest = createManifest();
        const encoded = encodeDatabaseBlockManifest(manifest);

        expect(isDatabaseBlockManifest(encoded)).toBe(true);
        expect(decodeDatabaseBlockManifest(encoded)).toEqual(manifest);
        expect(isDatabaseBlockManifest(new Uint8Array([1, 2, 3]))).toBe(false);
    });

    it("writes immutable content-addressed blocks", async () => {
        const storage = new MemoryBlockStorage();
        const first = await writeDatabaseBlock(storage, "database/blocks/v2/root.bin", { value: 1 });
        const second = await writeDatabaseBlock(storage, "database/blocks/v2/root.bin", { value: 1 });

        expect(first.key).toBe(second.key);
        expect(storage.values.size).toBe(1);
        expect(storage.writes).toHaveLength(1);
        expect(await readDatabaseBlock(storage, first)).toEqual({ value: 1 });
    });

    it("rejects missing and corrupted blocks", async () => {
        const storage = new MemoryBlockStorage();
        const ref = await writeDatabaseBlock(storage, "database/blocks/v2/root.bin", { value: 1 });

        storage.values.set(ref.key, new Uint8Array([1, 2, 3]));
        await expect(readDatabaseBlock(storage, ref)).rejects.toThrow("hash mismatch");

        storage.values.delete(ref.key);
        await expect(readDatabaseBlock(storage, ref)).rejects.toThrow("Missing database block");
    });
});
