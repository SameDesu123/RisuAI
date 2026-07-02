import type { toSaveType } from "./risuSave";

export type SaveDirtyFlag = Exclude<keyof toSaveType, 'character'|'chat'>

type VersionedFlags = Record<SaveDirtyFlag, number>

export type SaveDirtySnapshot = {
    toSave: toSaveType
    characterVersions: Map<string, number>
    chatVersions: Map<string, number>
    flagVersions: Partial<VersionedFlags>
}

const saveDirtyFlags: SaveDirtyFlag[] = [
    'botPreset',
    'modules',
    'loadouts',
    'plugins',
    'pluginCustomStorage'
]

function chatKey(chaId:string, chatId:string){
    return `${chaId}\0${chatId}`
}

function chatPair(key:string):[string, string]{
    const split = key.indexOf('\0')
    if(split === -1){
        return [key, '']
    }
    return [key.slice(0, split), key.slice(split + 1)]
}

function emptyToSave():toSaveType{
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false
    }
}

export class SaveDirtyTracker {
    private version = 0
    private characters = new Map<string, number>()
    private chats = new Map<string, number>()
    private flags: Partial<VersionedFlags> = {}

    markCharacter(chaId?:string){
        if(!chaId){
            return
        }
        this.characters.set(chaId, ++this.version)
    }

    markChat(chaId?:string, chatId?:string){
        if(!chaId || !chatId){
            return
        }
        this.chats.set(chatKey(chaId, chatId), ++this.version)
    }

    markFlag(flag:SaveDirtyFlag){
        this.flags[flag] = ++this.version
    }

    hasChanges(){
        return (
            this.characters.size > 0 ||
            this.chats.size > 0 ||
            saveDirtyFlags.some((flag) => this.flags[flag] !== undefined)
        )
    }

    snapshot():SaveDirtySnapshot{
        const toSave = emptyToSave()
        const characterVersions = new Map(this.characters)
        const chatVersions = new Map(this.chats)
        const flagVersions: Partial<VersionedFlags> = {}

        toSave.character = [...characterVersions.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([chaId]) => chaId)
        toSave.chat = [...chatVersions.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([key]) => chatPair(key))

        for(const flag of saveDirtyFlags){
            if(this.flags[flag] !== undefined){
                toSave[flag] = true
                flagVersions[flag] = this.flags[flag]
            }
        }

        return {
            toSave,
            characterVersions,
            chatVersions,
            flagVersions
        }
    }

    ack(snapshot:SaveDirtySnapshot){
        for(const [chaId, version] of snapshot.characterVersions){
            if((this.characters.get(chaId) ?? -1) <= version){
                this.characters.delete(chaId)
            }
        }
        for(const [key, version] of snapshot.chatVersions){
            if((this.chats.get(key) ?? -1) <= version){
                this.chats.delete(key)
            }
        }
        for(const flag of saveDirtyFlags){
            const version = snapshot.flagVersions[flag]
            if(version !== undefined && (this.flags[flag] ?? -1) <= version){
                delete this.flags[flag]
            }
        }
    }
}
