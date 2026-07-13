export interface ContextualChatVarTarget {
    scriptstate?: {[key: string]: string|number|boolean}
}

export function createContextualChatVarAccessors(
    chat: ContextualChatVarTarget,
    getDefaults: () => [string, string][],
) {
    return {
        getVar(key: string): string {
            chat.scriptstate ??= {}
            const value = chat.scriptstate['$' + key]
            if(value !== undefined && value !== null) return value.toString()
            return getDefaults().find((entry) => entry[0] === key)?.[1] ?? 'null'
        },
        setVar(key: string, value: string): void {
            chat.scriptstate ??= {}
            chat.scriptstate['$' + key] = value
        },
    }
}
