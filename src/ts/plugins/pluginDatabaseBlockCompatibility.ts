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
    const character = database.characters?.[index];
    if (!character) {
        return null;
    }
    await hydrate(index);
    const currentIndex = database.characters?.indexOf(character) ?? -1;
    return currentIndex === -1 ? null : snapshot(database.characters![currentIndex]);
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
    const currentIndex = database.characters.indexOf(current);
    if (currentIndex === -1) {
        return false;
    }
    const previousCharacterId = current.chaId;
    for (const chat of character.chats ?? []) {
        delete chat.databaseBlockStorage;
    }
    database.characters[currentIndex] = character;
    markCharacter(previousCharacterId);
    markCharacter(character.chaId);
    for (const chat of character.chats ?? []) {
        markChat(character.chaId ?? previousCharacterId, chat.id);
    }
    return true;
}

export async function readHydratedPluginChat<
    Character extends PluginCharacter,
    Chat extends PluginChat,
>(
    database: { characters?: Character[] },
    characterIndex: number,
    chatIndex: number,
    hydrate: (characterIndex: number, chatIndex: number) => Promise<unknown>,
    snapshot: (chat: PluginChat) => Chat,
) {
    const character = database.characters?.[characterIndex];
    const chat = character?.chats?.[chatIndex];
    if (!character || !chat) {
        return null;
    }
    const hydrated = await hydrate(characterIndex, chatIndex) as PluginChat | null;
    const currentCharacterIndex = database.characters?.indexOf(character) ?? -1;
    const currentChatIndex = hydrated ? character.chats?.indexOf(hydrated) ?? -1 : -1;
    if (currentCharacterIndex === -1 || currentChatIndex === -1) {
        return null;
    }
    return snapshot(character.chats![currentChatIndex]);
}

export async function replaceHydratedPluginChat<
    Character extends PluginCharacter,
    Chat extends PluginChat,
>(
    database: { characters?: Character[] },
    characterIndex: number,
    chatIndex: number,
    chat: Chat,
    hydrate: (characterIndex: number, chatIndex: number) => Promise<unknown>,
    markCharacter: (characterId?: string) => void,
    markChat: (characterId?: string, chatId?: string) => void,
) {
    const character = database.characters?.[characterIndex];
    const currentChat = character?.chats?.[chatIndex];
    if (!character || !currentChat) {
        return false;
    }
    const hydrated = await hydrate(characterIndex, chatIndex) as PluginChat | null;
    const currentCharacterIndex = database.characters?.indexOf(character) ?? -1;
    const currentChatIndex = hydrated ? character.chats?.indexOf(hydrated) ?? -1 : -1;
    if (currentCharacterIndex === -1 || currentChatIndex === -1) {
        return false;
    }
    const previousChatId = hydrated?.id;
    delete chat.databaseBlockStorage;
    character.chats![currentChatIndex] = chat;
    if (chat.id && chat.id !== previousChatId) {
        markCharacter(character.chaId);
    }
    markChat(character.chaId, chat.id ?? previousChatId);
    return true;
}
