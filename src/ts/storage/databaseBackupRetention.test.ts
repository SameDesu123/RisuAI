import { describe, expect, it } from "vitest";
import { retainDatabaseBackupIds } from "./databaseBackupRetention";

describe("databaseBackupRetention", () => {
    it("adds a backup without rescanning storage and removes only overflow", () => {
        const existing = Array.from({ length: 20 }, (_, index) => 120 - index);
        const result = retainDatabaseBackupIds(existing, 121);

        expect(result.retained).toEqual(Array.from({ length: 20 }, (_, index) => 121 - index));
        expect(result.removed).toEqual([101]);
    });

    it("deduplicates backup identifiers", () => {
        expect(retainDatabaseBackupIds([3, 2, 1], 3, 3)).toEqual({
            retained: [3, 2, 1],
            removed: [],
        });
    });
});
