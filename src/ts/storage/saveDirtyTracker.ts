import type { toSaveType } from "./risuSave";

export type SaveDirtyFlag = Exclude<keyof toSaveType, "character" | "chat">;

type VersionedFlags = Record<SaveDirtyFlag, number>;

export type SaveDirtySnapshot = {
    toSave: toSaveType;
    rootVersion?: number;
    characterVersions: Map<string, number>;
    chatVersions: Map<string, number>;
    flagVersions: Partial<VersionedFlags>;
};

const saveDirtyFlags: SaveDirtyFlag[] = [
    "botPreset",
    "modules",
    "loadouts",
    "plugins",
    "pluginCustomStorage",
];

function chatKey(characterId: string, chatId: string) {
    return `${characterId}\0${chatId}`;
}

function chatPair(key: string): [string, string] {
    const split = key.indexOf("\0");
    return split === -1
        ? [key, ""]
        : [key.slice(0, split), key.slice(split + 1)];
}

function emptyToSave(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    };
}

export class SaveDirtyTracker {
    private version = 0;
    private rootVersion?: number;
    private characters = new Map<string, number>();
    private chats = new Map<string, number>();
    private flags: Partial<VersionedFlags> = {};

    markRoot() {
        this.rootVersion = ++this.version;
    }

    markCharacter(characterId?: string) {
        if (characterId) {
            this.characters.set(characterId, ++this.version);
        }
    }

    markChat(characterId?: string, chatId?: string) {
        if (characterId && chatId) {
            this.chats.set(chatKey(characterId, chatId), ++this.version);
        }
    }

    markFlag(flag: SaveDirtyFlag) {
        this.flags[flag] = ++this.version;
    }

    hasChanges() {
        return this.rootVersion !== undefined
            || this.characters.size > 0
            || this.chats.size > 0
            || saveDirtyFlags.some((flag) => this.flags[flag] !== undefined);
    }

    snapshot(): SaveDirtySnapshot {
        const toSave = emptyToSave();
        const characterVersions = new Map(this.characters);
        const chatVersions = new Map(this.chats);
        const flagVersions: Partial<VersionedFlags> = {};

        toSave.character = [...characterVersions.entries()]
            .sort((first, second) => second[1] - first[1])
            .map(([characterId]) => characterId);
        toSave.chat = [...chatVersions.entries()]
            .sort((first, second) => second[1] - first[1])
            .map(([key]) => chatPair(key));

        for (const flag of saveDirtyFlags) {
            if (this.flags[flag] !== undefined) {
                toSave[flag] = true;
                flagVersions[flag] = this.flags[flag];
            }
        }

        return {
            toSave,
            rootVersion: this.rootVersion,
            characterVersions,
            chatVersions,
            flagVersions,
        };
    }

    ack(snapshot: SaveDirtySnapshot) {
        if (
            snapshot.rootVersion !== undefined
            && (this.rootVersion ?? -1) <= snapshot.rootVersion
        ) {
            this.rootVersion = undefined;
        }
        for (const [characterId, version] of snapshot.characterVersions) {
            if ((this.characters.get(characterId) ?? -1) <= version) {
                this.characters.delete(characterId);
            }
        }
        for (const [key, version] of snapshot.chatVersions) {
            if ((this.chats.get(key) ?? -1) <= version) {
                this.chats.delete(key);
            }
        }
        for (const flag of saveDirtyFlags) {
            const version = snapshot.flagVersions[flag];
            if (version !== undefined && (this.flags[flag] ?? -1) <= version) {
                delete this.flags[flag];
            }
        }
    }
}
