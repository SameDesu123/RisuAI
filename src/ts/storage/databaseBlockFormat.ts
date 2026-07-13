import { compressSync, decompressSync } from "fflate";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const manifestHeader = textEncoder.encode("RISUDBLOCK\x00\x02");
const blockHeader = textEncoder.encode("RISUDBLOCKITEM\x00\x01");

export const databaseBlockNamespace = "database/blocks/v2";

export type DatabaseBlockStorageAdapter = {
    getItem(key: string): Promise<Uint8Array | ArrayBuffer | null>;
    setItem(key: string, value: Uint8Array): Promise<unknown>;
    setItemAtomic?: (key: string, value: Uint8Array) => Promise<unknown>;
    keys?: () => Promise<string[]>;
    removeItem?: (key: string) => Promise<unknown>;
};

export type DatabaseBlockRef = {
    key: string;
    hash: string;
    byteLength: number;
    updatedAt: number;
};

type DatabaseBlockBackedValue = {
    databaseBlockStorage?: DatabaseBlockRef;
};

export type DatabaseBlockManifest = {
    kind: "risu-database-block-manifest";
    version: 2;
    updatedAt: number;
    root: Record<string, unknown>;
    components: Record<string, DatabaseBlockRef>;
    characters: {
        order: string[];
        refs: Record<string, DatabaseBlockRef>;
        chatRefs: Record<string, {
            order: string[];
            refs: Record<string, DatabaseBlockRef>;
        }>;
    };
};

type DatabaseBlockPayload<T> = {
    kind: "risu-database-block";
    version: 1;
    data: T;
};

function concatBytes(first: Uint8Array, second: Uint8Array) {
    const result = new Uint8Array(first.length + second.length);
    result.set(first, 0);
    result.set(second, first.length);
    return result;
}

function startsWith(data: Uint8Array, prefix: Uint8Array) {
    if (data.length < prefix.length) {
        return false;
    }
    for (let index = 0; index < prefix.length; index++) {
        if (data[index] !== prefix[index]) {
            return false;
        }
    }
    return true;
}

function toUint8Array(data: Uint8Array | ArrayBuffer | null | undefined): Uint8Array | null {
    if (!data) {
        return null;
    }
    return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function encodeJsonPayload(header: Uint8Array, data: unknown) {
    const json = textEncoder.encode(JSON.stringify(data));
    return concatBytes(header, compressSync(json));
}

function decodeJsonPayload<T>(header: Uint8Array, data: Uint8Array): T {
    if (!startsWith(data, header)) {
        throw new Error("Invalid database block header");
    }
    const decompressed = decompressSync(data.slice(header.length));
    return JSON.parse(textDecoder.decode(decompressed)) as T;
}

async function sha256Hex(data: Uint8Array) {
    const input = new Uint8Array(data).buffer;
    const hash = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

export function isDatabaseBlockManifest(data: Uint8Array | ArrayBuffer | null | undefined) {
    const bytes = toUint8Array(data);
    return !!bytes && startsWith(bytes, manifestHeader);
}

export function getAttachedDatabaseBlockRef(value: unknown) {
    const ref = (value as DatabaseBlockBackedValue | null)?.databaseBlockStorage;
    if (!ref || typeof ref.key !== "string" || typeof ref.hash !== "string") {
        return null;
    }
    return ref;
}

export function encodeDatabaseBlockManifest(manifest: DatabaseBlockManifest) {
    return encodeJsonPayload(manifestHeader, manifest);
}

export function decodeDatabaseBlockManifest(data: Uint8Array | ArrayBuffer): DatabaseBlockManifest {
    const bytes = toUint8Array(data);
    if (!bytes) {
        throw new Error("Missing database block manifest");
    }
    const manifest = decodeJsonPayload<DatabaseBlockManifest>(manifestHeader, bytes);
    if (manifest.kind !== "risu-database-block-manifest" || manifest.version !== 2) {
        throw new Error("Unsupported database block manifest");
    }
    return manifest;
}

export async function writeDatabaseBlock<T>(
    storage: DatabaseBlockStorageAdapter,
    baseKey: string,
    data: T,
): Promise<DatabaseBlockRef> {
    const encoded = encodeJsonPayload(blockHeader, {
        kind: "risu-database-block",
        version: 1,
        data,
    } satisfies DatabaseBlockPayload<T>);
    const hash = await sha256Hex(encoded);
    const key = baseKey.endsWith(".bin")
        ? `${baseKey.slice(0, -4)}-${hash.slice(0, 16)}.bin`
        : `${baseKey}-${hash.slice(0, 16)}`;
    const existing = toUint8Array(await storage.getItem(key));
    if (!existing || await sha256Hex(existing) !== hash) {
        if (storage.setItemAtomic) {
            await storage.setItemAtomic(key, encoded);
        }
        else {
            await storage.setItem(key, encoded);
        }
    }
    return {
        key,
        hash,
        byteLength: encoded.byteLength,
        updatedAt: Date.now(),
    };
}

export async function readDatabaseBlock<T>(
    storage: DatabaseBlockStorageAdapter,
    ref: DatabaseBlockRef,
): Promise<T> {
    const data = toUint8Array(await storage.getItem(ref.key));
    if (!data) {
        throw new Error(`Missing database block: ${ref.key}`);
    }
    const hash = await sha256Hex(data);
    if (hash !== ref.hash) {
        throw new Error(`Database block hash mismatch: ${ref.key}`);
    }
    const payload = decodeJsonPayload<DatabaseBlockPayload<T>>(blockHeader, data);
    if (payload.kind !== "risu-database-block" || payload.version !== 1) {
        throw new Error(`Invalid database block payload: ${ref.key}`);
    }
    return payload.data;
}
