import { describe, expect, it } from "vitest"
import type { Database } from "../database.svelte"
import type { toSaveType } from "../risuSave"
import { SaveSectionTracker } from "./saveSectionTracker"

const emptyTargets = (): toSaveType => ({
    character: [],
    chat: [],
    botPreset: false,
    modules: false,
    loadouts: false,
    plugins: false,
    pluginCustomStorage: false,
})

function database(): Database {
    return {
        username: "User",
        theme: "dark",
        characters: [{
            chaId: "character-1",
            name: "Character",
            chats: [{ id: "chat-1", message: [{ role: "user", data: "Hello" }] }],
            regex: [{ id: "regex-1", comment: "First" }],
            trigger: [],
            lorebook: [],
        }],
        botPresets: [{ id: "preset-1", name: "Preset", mainPrompt: "Prompt" }],
        modules: [{ id: "module-1", name: "Module", description: "Description" }],
        plugins: [{ id: "plugin-1", name: "Plugin", enabled: true }],
        pluginCustomStorage: { "plugin-1": { counter: 1 } },
        loadouts: [{ id: "loadout-1", name: "Loadout", favorite: false }],
    } as unknown as Database
}

function prepare(tracker: SaveSectionTracker, data: Database) {
    return tracker.prepare(data, { reason: "dirty", legacyTargets: emptyTargets() })
}

describe("SaveSectionTracker", () => {
    it("starts from a quiet baseline", () => {
        const data = database()
        const tracker = new SaveSectionTracker(data)

        expect(prepare(tracker, structuredClone(data)).report.changes).toEqual([])
    })

    it("reports known and unknown root fields without values", () => {
        const data = database()
        const tracker = new SaveSectionTracker(data)
        data.username = "Changed"
        ;(data as unknown as Record<string, unknown>).futureSetting = "secret value"

        expect(prepare(tracker, data).report.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({ scope: "root", section: "user", kind: "updated", fields: ["username"] }),
            expect.objectContaining({ scope: "root", section: "unknown", kind: "added", fields: ["futureSetting"] }),
        ]))
        expect(JSON.stringify(prepare(tracker, data).report)).not.toContain("secret value")
    })

    it("separates character, chat, and nested resource changes", () => {
        const data = database()
        const tracker = new SaveSectionTracker(data)
        const character = data.characters[0] as any
        character.firstMessage = "New greeting"
        character.chats[0].message.push({ role: "char", data: "Hi" })
        character.regex[0].comment = "Changed"

        expect(prepare(tracker, data).report.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                scope: "character", section: "greeting", resourceId: "character-1", fields: ["firstMessage"],
            }),
            expect.objectContaining({
                scope: "chat", section: "messages", ownerId: "character-1", resourceId: "chat-1", fields: ["message"],
            }),
            expect.objectContaining({
                scope: "character.regex", section: "entry", ownerId: "character-1", resourceId: "regex-1",
                fields: ["comment"],
            }),
        ]))
    })

    it("reports resource additions, removals, and stable-id reordering", () => {
        const data = database()
        data.modules.push({ id: "module-2", name: "Second" } as any)
        const tracker = new SaveSectionTracker(data)

        data.modules.reverse()
        data.botPresets = []
        data.loadouts.push({ id: "loadout-2", name: "Second" } as any)
        const changes = prepare(tracker, data).report.changes

        expect(changes).toEqual(expect.arrayContaining([
            expect.objectContaining({ scope: "module", section: "order", kind: "reordered" }),
            expect.objectContaining({ scope: "preset", resourceId: "preset-1", kind: "removed" }),
            expect.objectContaining({ scope: "loadout", resourceId: "loadout-2", kind: "added" }),
        ]))
    })

    it("advances the baseline only when the prepared batch is committed", () => {
        const data = database()
        const tracker = new SaveSectionTracker(data)
        data.theme = "light"

        const failed = prepare(tracker, data)
        expect(failed.report.changes).toHaveLength(1)
        expect(prepare(tracker, data).report.changes).toEqual(failed.report.changes)

        tracker.commit(failed)
        expect(prepare(tracker, data).report.changes).toEqual([])
    })

    it("preserves the forced reload reason even without data changes", () => {
        const data = database()
        const tracker = new SaveSectionTracker(data)

        const prepared = tracker.prepare(data, {
            reason: "forced-full-reload",
            legacyTargets: emptyTargets(),
        })

        expect(prepared.report).toMatchObject({ reason: "forced-full-reload", changes: [] })
    })

    it("keeps a diagnostic copy when the encoder mutates legacy targets", () => {
        const data = database()
        const tracker = new SaveSectionTracker(data)
        const legacyTargets = emptyTargets()
        legacyTargets.character.push("character-1")
        legacyTargets.chat.push(["character-1", "chat-1"])

        const prepared = tracker.prepare(data, { reason: "dirty", legacyTargets })
        legacyTargets.character.splice(0)
        legacyTargets.chat[0][1] = "changed-by-encoder"

        expect(prepared.report.legacyTargets).toMatchObject({
            character: ["character-1"],
            chat: [["character-1", "chat-1"]],
        })
    })
})
