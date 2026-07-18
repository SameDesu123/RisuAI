import { describe, expect, it } from 'vitest'
import { expandChatSaveTargets, SaveAreaTracker } from './saveAreaDetector'

describe('SaveAreaTracker', () => {
    it('tracks root, character, chat, and dedicated save areas independently', () => {
        const tracker = new SaveAreaTracker()
        tracker.markRoot()
        tracker.markCharacter('char-1')
        tracker.markChat('char-1', 'chat-1')
        tracker.markFlag('modules')

        const batch = tracker.snapshot()
        expect(batch.rootVersion).toBeDefined()
        expect(batch.toSave.character).toEqual(['char-1'])
        expect(batch.toSave.chat).toEqual([['char-1', 'chat-1']])
        expect(batch.toSave.modules).toBe(true)
        expect(batch.toSave.plugins).toBe(false)
    })

    it('maps chat targets to parent character blocks for the current encoder', () => {
        const tracker = new SaveAreaTracker()
        tracker.markChat('char-1', 'chat-1')
        tracker.markChat('char-2', 'chat-2')
        tracker.markCharacter('char-2')

        const original = tracker.snapshot().toSave
        const expanded = expandChatSaveTargets(original)

        expect(expanded.character).toEqual(['char-2', 'char-1'])
        expect(expanded.chat).toEqual([
            ['char-1', 'chat-1'],
            ['char-2', 'chat-2'],
        ])
        expect(original.character).toEqual(['char-2'])
    })

    it('keeps an unacknowledged batch pending after a failed save', () => {
        const tracker = new SaveAreaTracker()
        tracker.markFlag('plugins')
        const failedBatch = tracker.snapshot()

        expect(failedBatch.toSave.plugins).toBe(true)
        expect(tracker.snapshot().toSave.plugins).toBe(true)
        expect(tracker.hasChanges()).toBe(true)
    })

    it('clears only the areas acknowledged after a successful save', () => {
        const tracker = new SaveAreaTracker()
        tracker.markRoot()
        tracker.markCharacter('char-1')
        tracker.markChat('char-1', 'chat-1')
        tracker.markFlag('pluginCustomStorage')

        const batch = tracker.snapshot()
        tracker.ack(batch)

        expect(tracker.hasChanges()).toBe(false)
    })

    it('preserves changes made while a save is in flight', () => {
        const tracker = new SaveAreaTracker()
        tracker.markCharacter('char-1')
        tracker.markChat('char-1', 'chat-1')
        const inFlight = tracker.snapshot()

        tracker.markChat('char-1', 'chat-1')
        tracker.markChat('char-1', 'chat-2')
        tracker.markFlag('loadouts')
        tracker.ack(inFlight)

        const nextBatch = tracker.snapshot()
        expect(nextBatch.toSave.character).toEqual([])
        expect(nextBatch.toSave.chat).toEqual([
            ['char-1', 'chat-1'],
            ['char-1', 'chat-2'],
        ])
        expect(nextBatch.toSave.loadouts).toBe(true)
    })

    it('falls back cleanly when an entity has no stable id', () => {
        const tracker = new SaveAreaTracker()

        expect(tracker.markCharacter()).toBe(false)
        expect(tracker.markChat('char-1')).toBe(false)
        expect(tracker.hasChanges()).toBe(false)
    })
})
