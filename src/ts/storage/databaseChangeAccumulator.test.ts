import { describe, expect, it } from 'vitest'
import type { Database } from './database.svelte'
import type { DatabaseUpdateInfo } from './databaseState.svelte'
import { cloneChangeTracker, DatabaseChangeAccumulator } from './databaseChangeAccumulator'

type TestCharacter = Database['characters'][number]

function character(chaId: string): TestCharacter {
    return { chaId } as TestCharacter
}

function database(characters: TestCharacter[] = []): Database {
    return { characters } as Database
}

function update(
    path: DatabaseUpdateInfo['path'],
    values: Partial<Omit<DatabaseUpdateInfo, 'path'>> = {},
): DatabaseUpdateInfo {
    return {
        path,
        value: undefined,
        oldValue: undefined,
        type: 'set',
        ...values,
    }
}

function record(
    accumulator: DatabaseChangeAccumulator,
    info: DatabaseUpdateInfo,
    characters: TestCharacter[] = [],
    selectedCharacterIndex = 0,
) {
    return accumulator.record(info, {
        database: database(characters),
        selectedCharacterIndex,
    })
}

describe('DatabaseChangeAccumulator', () => {
    it('starts empty', () => {
        const accumulator = new DatabaseChangeAccumulator()

        expect(accumulator.hasChanges()).toBe(false)
        expect(accumulator.take()).toEqual({
            character: [],
            botPreset: false,
            modules: false,
            loadouts: false,
            plugins: false,
            pluginCustomStorage: false,
        })
    })

    it.each([
        ['botPresets', 'botPreset'],
        ['botPresetsId', 'botPreset'],
        ['modules', 'modules'],
        ['loadouts', 'loadouts'],
        ['plugins', 'plugins'],
        ['pluginCustomStorage', 'pluginCustomStorage'],
    ] as const)('classifies %s as a %s change', (root, flag) => {
        const accumulator = new DatabaseChangeAccumulator()

        record(accumulator, update([root]))

        expect(accumulator.take()[flag]).toBe(true)
    })

    it('tracks the character for a nested character update', () => {
        const accumulator = new DatabaseChangeAccumulator()
        const characters = [character('A'), character('B')]

        record(accumulator, update(['characters', 1, 'chats', 0, 'message', 3]), characters)

        expect(accumulator.take().character).toEqual(['B'])
    })

    it('deduplicates repeated changes for the same character', () => {
        const accumulator = new DatabaseChangeAccumulator()
        const characters = [character('A')]

        record(accumulator, update(['characters', 0, 'name']), characters)
        record(accumulator, update(['characters', 0, 'chats', 0]), characters)

        expect(accumulator.take().character).toEqual(['A'])
    })

    it('tracks a deleted character from the old value', () => {
        const accumulator = new DatabaseChangeAccumulator()

        record(accumulator, update(['characters', 1], {
            oldValue: character('removed'),
            type: 'delete',
        }), [character('remaining')])

        expect(accumulator.take().character).toEqual(['removed'])
    })

    it('tracks characters from both sides of an array replacement', () => {
        const accumulator = new DatabaseChangeAccumulator()

        record(accumulator, update(['characters'], {
            oldValue: [character('old'), character('shared')],
            value: [character('shared'), character('new')],
        }))

        expect(accumulator.take().character).toEqual(['new', 'shared', 'old'])
    })

    it('tracks the selected character for other root changes', () => {
        const accumulator = new DatabaseChangeAccumulator()
        const characters = [character('A'), character('B')]

        record(accumulator, update(['username']), characters, 1)

        expect(accumulator.take().character).toEqual(['B'])
    })

    it('does not track a character when the selected index is invalid', () => {
        const accumulator = new DatabaseChangeAccumulator()

        record(accumulator, update(['username']), [character('A')], 4)

        expect(accumulator.hasChanges()).toBe(false)
    })

    it('requests a full encoder reload for a root replacement', () => {
        const accumulator = new DatabaseChangeAccumulator()

        const result = record(accumulator, update([]))

        expect(result.requiresFullEncoderReload).toBe(true)
        expect(accumulator.hasChanges()).toBe(false)
    })

    it('resets after take', () => {
        const accumulator = new DatabaseChangeAccumulator()

        record(accumulator, update(['modules']))

        expect(accumulator.take().modules).toBe(true)
        expect(accumulator.take().modules).toBe(false)
    })

    it('returns snapshots independent from later changes', () => {
        const accumulator = new DatabaseChangeAccumulator()

        record(accumulator, update(['characters', 0, 'name']), [character('A')])
        const first = accumulator.take()
        record(accumulator, update(['characters', 0, 'name']), [character('B')])

        expect(first.character).toEqual(['A'])
        expect(accumulator.take().character).toEqual(['B'])
    })

    it('restores a failed save without losing changes recorded in flight', () => {
        const accumulator = new DatabaseChangeAccumulator()

        record(accumulator, update(['characters', 0, 'name']), [character('A')])
        const pending = accumulator.take()
        record(accumulator, update(['characters', 0, 'name']), [character('B')])
        accumulator.restore(pending)

        expect(accumulator.take().character).toEqual(['B', 'A'])
    })

    it('keeps pending changes intact when an encoder mutates its copy', () => {
        const accumulator = new DatabaseChangeAccumulator()

        record(accumulator, update(['characters', 0, 'name']), [character('A')])
        const pending = accumulator.take()
        const encoderChanges = cloneChangeTracker(pending)
        encoderChanges.character.splice(0, 1)
        accumulator.restore(pending)

        expect(accumulator.take().character).toEqual(['A'])
    })

    it('merges boolean flags when restoring a failed save', () => {
        const accumulator = new DatabaseChangeAccumulator()

        record(accumulator, update(['modules']))
        const pending = accumulator.take()
        record(accumulator, update(['plugins']))
        accumulator.restore(pending)

        expect(accumulator.take()).toMatchObject({
            modules: true,
            plugins: true,
        })
    })
})
