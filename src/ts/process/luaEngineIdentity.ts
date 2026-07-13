export function buildLuaEngineKey(arg: {
    characterId?: string
    chatId?: string
    chatPage?: number
    source: string
    triggerIndex: number
}): string {
    return `${buildLuaEngineContextPrefix(arg)}${arg.source}:${arg.triggerIndex}`
}

export function buildLuaEngineContextPrefix(arg: {
    characterId?: string
    chatId?: string
    chatPage?: number
}): string {
    return ['lua', arg.characterId ?? 'group', arg.chatId ?? String(arg.chatPage ?? 0), ''].join(':')
}

export function buildLuaRuntimeContextSignature(contextPrefix: string, moduleIds: string[]): string {
    return `${contextPrefix}modules:${moduleIds.join(',')}`
}
