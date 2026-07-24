import type { Database } from './database.svelte'
import type { DatabaseUpdateInfo } from './databaseState.svelte'
import type { toSaveType } from './risuSave'

export interface DatabaseChangeContext {
    database: Database
    selectedCharacterIndex: number
}

export interface DatabaseChangeResult {
    requiresFullEncoderReload: boolean
}

function createChangeTracker(): toSaveType {
    return {
        character: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

export function cloneChangeTracker(tracker: toSaveType): toSaveType {
    return {
        ...tracker,
        character: [...tracker.character],
    }
}

function mergeChangeTrackers(target: toSaveType, source: toSaveType) {
    for (const characterId of source.character) {
        if (!target.character.includes(characterId)) {
            target.character.push(characterId)
        }
    }
    target.botPreset ||= source.botPreset
    target.modules ||= source.modules
    target.loadouts ||= source.loadouts
    target.plugins ||= source.plugins
    target.pluginCustomStorage ||= source.pluginCustomStorage
}

export class DatabaseChangeAccumulator {
    private changes = createChangeTracker()

    record(info: DatabaseUpdateInfo, context: DatabaseChangeContext): DatabaseChangeResult {
        if (info.path.length === 0) {
            return {
                requiresFullEncoderReload: true,
            }
        }

        const rootKey = info.path[0]

        if (rootKey === 'botPresets' || rootKey === 'botPresetsId') {
            this.changes.botPreset = true
            return {
                requiresFullEncoderReload: false,
            }
        }

        if (rootKey === 'modules') {
            this.changes.modules = true
            return {
                requiresFullEncoderReload: false,
            }
        }

        if (rootKey === 'loadouts' || rootKey === 'plugins' || rootKey === 'pluginCustomStorage') {
            this.changes[rootKey] = true
            return {
                requiresFullEncoderReload: false,
            }
        }

        if (rootKey === 'characters') {
            const affectedCharacters: Database['characters'] = []

            if (info.path.length === 1) {
                const oldCharacters = info.oldValue as Database['characters'] | undefined
                const newCharacters = info.value as Database['characters'] | undefined
                affectedCharacters.push(...(oldCharacters ?? []), ...(newCharacters ?? []))
            }
            else if (typeof info.path[1] === 'number') {
                if (info.path.length === 2) {
                    const oldCharacter = info.oldValue as Database['characters'][number] | undefined
                    if (oldCharacter) {
                        affectedCharacters.push(oldCharacter)
                    }
                }
                const currentCharacter = context.database.characters[info.path[1]]
                if (currentCharacter) {
                    affectedCharacters.push(currentCharacter)
                }
            }

            for (const character of affectedCharacters) {
                this.recordCharacter(character.chaId)
            }

            return {
                requiresFullEncoderReload: false,
            }
        }

        const selectedCharacter = context.database.characters[context.selectedCharacterIndex]
        if (selectedCharacter) {
            this.recordCharacter(selectedCharacter.chaId)
        }

        return {
            requiresFullEncoderReload: false,
        }
    }

    take(): toSaveType {
        const changes = this.changes
        this.changes = createChangeTracker()
        return changes
    }

    restore(changes: toSaveType) {
        mergeChangeTrackers(this.changes, changes)
    }

    hasChanges(): boolean {
        return this.changes.character.length > 0 ||
            this.changes.botPreset ||
            this.changes.modules ||
            this.changes.loadouts ||
            this.changes.plugins ||
            this.changes.pluginCustomStorage
    }

    private recordCharacter(characterId: string) {
        if (!this.changes.character.includes(characterId)) {
            this.changes.character.unshift(characterId)
        }
    }
}
