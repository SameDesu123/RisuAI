import { describe, expect, it } from "vitest";
import { shuffle } from "./hypav3Retrieval";

function createSeededRandom(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

describe("shuffle", () => {
    it("produces a deterministic permutation with an injected RNG", () => {
        const input = [1, 2, 3, 4, 5, 6, 7, 8];

        const first = shuffle(input, createSeededRandom(42));
        const second = shuffle(input, createSeededRandom(42));

        expect(first).toEqual(second);
        expect([...first].sort((a, b) => a - b)).toEqual(input);
        expect(first).not.toEqual(input);
        expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it("uses every Fisher-Yates position, including index zero", () => {
        expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
    });
});
