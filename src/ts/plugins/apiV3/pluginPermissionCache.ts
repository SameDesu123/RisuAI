export type PluginPermission = 'fetchLogs' | 'db' | 'mainDom' | 'replacer' | 'provider' | 'sendChat'

export function getPluginPermissionKey(scriptHash: string, permission: PluginPermission): string {
    return `${scriptHash}_${permission}`
}

export class PluginPermissionSessionCache {
    private decisions = new Map<string, boolean>()

    get(scriptHash: string, permission: PluginPermission): boolean | undefined {
        return this.decisions.get(getPluginPermissionKey(scriptHash, permission))
    }

    set(scriptHash: string, permission: PluginPermission, granted: boolean): void {
        this.decisions.set(getPluginPermissionKey(scriptHash, permission), granted)
    }
}
