type PluginChat = {
    id?: string;
    databaseBlockStorage?: unknown;
};

type PluginCharacter = {
    chaId?: string;
    chats?: PluginChat[];
};

export async function readHydratedPluginCharacter<T extends PluginCharacter>(
    database: { characters?: T[] },
    index: number,
    hydrate: (index: number) => Promise<unknown>,
    snapshot: (character: T) => T,
) {
    if (!database.characters?.[index]) {
        return null;
    }
    await hydrate(index);
    const character = database.characters?.[index];
    return character ? snapshot(character) : null;
}

export async function replaceHydratedPluginCharacter<T extends PluginCharacter>(
    database: { characters?: T[] },
    index: number,
    character: T,
    hydrate: (index: number) => Promise<unknown>,
    markCharacter: (characterId?: string) => void,
    markChat: (characterId?: string, chatId?: string) => void,
) {
    const current = database.characters?.[index];
    if (!current || !database.characters) {
        return false;
    }
    await hydrate(index);
    const previousCharacterId = database.characters[index]?.chaId;
    for (const chat of character.chats ?? []) {
        delete chat.databaseBlockStorage;
    }
    database.characters[index] = character;
    markCharacter(previousCharacterId);
    markCharacter(character.chaId);
    for (const chat of character.chats ?? []) {
        markChat(character.chaId ?? previousCharacterId, chat.id);
    }
    return true;
}
