import type { toSaveType } from './risuSave'

export type SaveAreaFlag = Exclude<keyof toSaveType, 'character' | 'chat'>
type VersionedFlags = Partial<Record<SaveAreaFlag, number>>

export type SaveAreaBatch = {
    toSave: toSaveType
    rootVersion?: number
    characterVersions: Map<string, number>
    chatVersions: Map<string, number>
    flagVersions: VersionedFlags
}

const saveAreaFlags: SaveAreaFlag[] = [
    'botPreset',
    'modules',
    'loadouts',
    'plugins',
    'pluginCustomStorage',
]

function createEmptySaveTargets(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

function createChatKey(chaId: string, chatId: string) {
    return `${chaId}\0${chatId}`
}

function parseChatKey(key: string): [string, string] {
    const separator = key.indexOf('\0')
    return [key.slice(0, separator), key.slice(separator + 1)]
}

export function expandChatSaveTargets(toSave: toSaveType): toSaveType {
    const character = [...toSave.character]
    for (const [chaId] of toSave.chat) {
        if (!character.includes(chaId)) {
            character.push(chaId)
        }
    }
    return {
        ...toSave,
        character,
        chat: toSave.chat.map(([chaId, chatId]) => [chaId, chatId]),
    }
}

export class SaveAreaTracker {
    private version = 0
    private rootVersion: number | undefined
    private characterVersions = new Map<string, number>()
    private chatVersions = new Map<string, number>()
    private flagVersions: VersionedFlags = {}

    markRoot() {
        this.rootVersion = ++this.version
    }

    markCharacter(chaId?: string) {
        if (!chaId) {
            return false
        }
        this.characterVersions.set(chaId, ++this.version)
        return true
    }

    markChat(chaId?: string, chatId?: string) {
        if (!chaId || !chatId) {
            return false
        }
        this.chatVersions.set(createChatKey(chaId, chatId), ++this.version)
        return true
    }

    markFlag(flag: SaveAreaFlag) {
        this.flagVersions[flag] = ++this.version
    }

    hasChanges() {
        return (
            this.rootVersion !== undefined ||
            this.characterVersions.size > 0 ||
            this.chatVersions.size > 0 ||
            saveAreaFlags.some((flag) => this.flagVersions[flag] !== undefined)
        )
    }

    snapshot(): SaveAreaBatch {
        const toSave = createEmptySaveTargets()
        const characterVersions = new Map(this.characterVersions)
        const chatVersions = new Map(this.chatVersions)
        const flagVersions: VersionedFlags = {}

        toSave.character = [...characterVersions.entries()]
            .sort((left, right) => left[1] - right[1])
            .map(([chaId]) => chaId)
        toSave.chat = [...chatVersions.entries()]
            .sort((left, right) => left[1] - right[1])
            .map(([key]) => parseChatKey(key))

        for (const flag of saveAreaFlags) {
            if (this.flagVersions[flag] !== undefined) {
                toSave[flag] = true
                flagVersions[flag] = this.flagVersions[flag]
            }
        }

        return {
            toSave,
            rootVersion: this.rootVersion,
            characterVersions,
            chatVersions,
            flagVersions,
        }
    }

    ack(batch: SaveAreaBatch) {
        if (batch.rootVersion !== undefined && (this.rootVersion ?? -1) <= batch.rootVersion) {
            this.rootVersion = undefined
        }
        for (const [chaId, version] of batch.characterVersions) {
            if ((this.characterVersions.get(chaId) ?? -1) <= version) {
                this.characterVersions.delete(chaId)
            }
        }
        for (const [key, version] of batch.chatVersions) {
            if ((this.chatVersions.get(key) ?? -1) <= version) {
                this.chatVersions.delete(key)
            }
        }
        for (const flag of saveAreaFlags) {
            const version = batch.flagVersions[flag]
            if (version !== undefined && (this.flagVersions[flag] ?? -1) <= version) {
                delete this.flagVersions[flag]
            }
        }
    }
}
