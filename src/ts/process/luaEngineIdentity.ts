export function buildLuaEngineKey(arg: {
    characterId?: string
    chatId?: string
    chatPage?: number
    source: string
    triggerIndex: number
}): string {
    return ['lua', arg.characterId ?? 'group', arg.chatId ?? String(arg.chatPage ?? 0), arg.source, arg.triggerIndex].join(':')
}
