import { describe, expect, it } from 'vitest'
import { SaveDirtyTracker } from './saveDirtyTracker'

describe('SaveDirtyTracker', () => {
    it('keeps changes pending until an acknowledged snapshot', () => {
        const tracker = new SaveDirtyTracker()
        tracker.markCharacter('char-1')
        tracker.markChat('char-1', 'chat-1')
        tracker.markFlag('plugins')

        const failedSnapshot = tracker.snapshot()
        expect(failedSnapshot.toSave.character).toEqual(['char-1'])
        expect(failedSnapshot.toSave.chat).toEqual([['char-1', 'chat-1']])
        expect(failedSnapshot.toSave.plugins).toBe(true)

        expect(tracker.snapshot().toSave.character).toEqual(['char-1'])
        expect(tracker.snapshot().toSave.chat).toEqual([['char-1', 'chat-1']])
        expect(tracker.snapshot().toSave.plugins).toBe(true)
    })

    it('clears only entries included in a successful snapshot', () => {
        const tracker = new SaveDirtyTracker()
        tracker.markCharacter('char-1')
        tracker.markChat('char-1', 'chat-1')
        tracker.markFlag('modules')

        const snapshot = tracker.snapshot()
        tracker.ack(snapshot)

        const nextSnapshot = tracker.snapshot()
        expect(nextSnapshot.toSave.character).toEqual([])
        expect(nextSnapshot.toSave.chat).toEqual([])
        expect(nextSnapshot.toSave.modules).toBe(false)
        expect(tracker.hasChanges()).toBe(false)
    })

    it('preserves edits added while a save is in flight', () => {
        const tracker = new SaveDirtyTracker()
        tracker.markChat('char-1', 'chat-1')
        const inFlight = tracker.snapshot()

        tracker.markChat('char-1', 'chat-1')
        tracker.markChat('char-1', 'chat-2')
        tracker.ack(inFlight)

        const nextSnapshot = tracker.snapshot()
        expect(nextSnapshot.toSave.chat).toEqual([
            ['char-1', 'chat-2'],
            ['char-1', 'chat-1'],
        ])
    })

    it('can mark plugin-style non-active chat saves directly', () => {
        const tracker = new SaveDirtyTracker()
        tracker.markChat('char-2', 'chat-background')

        expect(tracker.snapshot().toSave.chat).toEqual([
            ['char-2', 'chat-background'],
        ])
    })
})
