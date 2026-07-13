import { describe, expect, it } from "vitest";
import { applyDatabaseBlockStorageDefault } from "./databaseBlockActivation";

describe("databaseBlockActivation", () => {
    it("enables block storage when the setting is absent", () => {
        expect(applyDatabaseBlockStorageDefault({}).databaseBlockStorage).toBe(true);
    });

    it("preserves an explicit opt-out", () => {
        expect(applyDatabaseBlockStorageDefault({ databaseBlockStorage: false }).databaseBlockStorage)
            .toBe(false);
    });
});
