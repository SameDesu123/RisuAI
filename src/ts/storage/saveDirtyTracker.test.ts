import { describe, expect, it } from "vitest";
import { SaveDirtyTracker } from "./saveDirtyTracker";

describe("SaveDirtyTracker", () => {
    it("keeps changes pending until a snapshot is acknowledged", () => {
        const tracker = new SaveDirtyTracker();
        tracker.markRoot();
        tracker.markCharacter("char-1");
        tracker.markChat("char-1", "chat-1");
        tracker.markFlag("plugins");

        const snapshot = tracker.snapshot();
        expect(snapshot.toSave.character).toEqual(["char-1"]);
        expect(snapshot.toSave.chat).toEqual([["char-1", "chat-1"]]);
        expect(snapshot.toSave.plugins).toBe(true);
        expect(tracker.hasChanges()).toBe(true);
    });

    it("clears entries included in a successful snapshot", () => {
        const tracker = new SaveDirtyTracker();
        tracker.markRoot();
        tracker.markCharacter("char-1");
        tracker.markChat("char-1", "chat-1");
        tracker.markFlag("modules");

        tracker.ack(tracker.snapshot());

        expect(tracker.hasChanges()).toBe(false);
        expect(tracker.snapshot().toSave.modules).toBe(false);
    });

    it("preserves edits added while a save is in flight", () => {
        const tracker = new SaveDirtyTracker();
        tracker.markChat("char-1", "chat-1");
        const inFlight = tracker.snapshot();

        tracker.markChat("char-1", "chat-1");
        tracker.markChat("char-1", "chat-2");
        tracker.ack(inFlight);

        expect(tracker.snapshot().toSave.chat).toEqual([
            ["char-1", "chat-2"],
            ["char-1", "chat-1"],
        ]);
    });

    it("tracks root-only changes independently", () => {
        const tracker = new SaveDirtyTracker();
        tracker.markRoot();
        const inFlight = tracker.snapshot();
        tracker.markRoot();
        tracker.ack(inFlight);

        expect(tracker.hasChanges()).toBe(true);
        tracker.ack(tracker.snapshot());
        expect(tracker.hasChanges()).toBe(false);
    });

    it("can mark a non-active plugin chat directly", () => {
        const tracker = new SaveDirtyTracker();
        tracker.markChat("char-2", "chat-background");

        expect(tracker.snapshot().toSave.chat).toEqual([
            ["char-2", "chat-background"],
        ]);
    });
});
