import { describe, expect, it, vi } from "vitest";

vi.mock("../util", () => ({
    asBuffer: (value: Uint8Array) => value,
}));

import { OpfsStorage } from "./opfsStorage";

describe("OpfsStorage", () => {
    it("waits for the writable stream to close before resolving a write", async () => {
        let finishClose: () => void = () => {};
        const close = vi.fn(() => new Promise<void>((resolve) => {
            finishClose = resolve;
        }));
        const write = vi.fn(async () => {});
        const storage = new OpfsStorage();
        storage.opfs = {
            getFileHandle: vi.fn(async () => ({
                createWritable: vi.fn(async () => ({ write, close })),
            })),
        } as unknown as FileSystemDirectoryHandle;

        let settled = false;
        const saving = storage.setItem("database/blocks/v2/test.bin", new Uint8Array([1]))
            .then(() => {
                settled = true;
            });
        await vi.waitFor(() => expect(close).toHaveBeenCalled());
        expect(settled).toBe(false);

        finishClose();
        await saving;
        expect(settled).toBe(true);
    });
});
