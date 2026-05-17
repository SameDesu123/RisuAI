export const workspaceFormatVersion = 1

export const workspaceManifestFileName = "risu.workspace.json"

export const workspaceDirectoryNames = {
    database: "database",
    settings: "settings",
    bots: "bots",
    presets: "presets",
    modules: "modules",
    plugins: "plugins",
    assets: "assets",
    indexes: "indexes",
    tmp: "tmp"
} as const

export const workspaceBotDirectoryNames = {
    chats: "chats",
    lorebooks: "lorebooks",
    asset: "asset",
    tts: "tts",
    script: "script",
    scriptRegex: "regex",
    scriptTriggers: "triggers",
    advanced: "advanced"
} as const

export const workspacePluginDirectoryNames = {
    storage: "storage"
} as const

export const workspaceFileNames = {
    databaseSnapshot: "source.database.bin",
    rootSettings: "root.risuset",
    bot: "bot.risubot",
    botAsset: "asset.risuasset",
    botTts: "tts.risutts",
    botScriptBackground: "background.risubg",
    botScriptVirtual: "virtual.risuscript",
    botAdvanced: "advanced.risuadv",
    botPresets: "botPresets.risupreset",
    modules: "modules.risumodule",
    plugins: "plugins.risuplug",
    pluginStorage: "pluginStorage.risuplugstore",
    pluginsIndex: "plugins.risuindex",
    pluginStorageIndex: "pluginStorage.risuindex",
    botsIndex: "bots.risuindex",
    chatsIndex: "chats.risuindex",
    regexIndex: "regex.risuindex",
    triggersIndex: "triggers.risuindex",
    lorebooksIndex: "lorebooks.risuindex"
} as const

export type WorkspaceFormatName =
    | "risu.workspace"
    | "risu.settings.root"
    | "risu.bot"
    | "risu.bot.asset"
    | "risu.bot.tts"
    | "risu.bot.script.background"
    | "risu.bot.script.virtual"
    | "risu.bot.advanced"
    | "risu.chat"
    | "risu.regex"
    | "risu.trigger"
    | "risu.lorebook"
    | "risu.botPresets"
    | "risu.modules"
    | "risu.plugin"
    | "risu.plugins"
    | "risu.pluginStorage.entry"
    | "risu.pluginStorage"
    | WorkspaceIndexFormatName

export type WorkspaceIndexFormatName =
    | "risu.index.bots"
    | "risu.index.chats"
    | "risu.index.regex"
    | "risu.index.triggers"
    | "risu.index.lorebooks"
    | "risu.index.plugins"
    | "risu.index.pluginStorage"

export type WorkspaceManifest = {
    format: "risu.workspace"
    version: typeof workspaceFormatVersion
    id: string
    createdAt: number
    updatedAt: number
    storageKind: "workspace-directory"
    source?: WorkspaceSourceInfo
    paths: WorkspaceManifestPaths
}

export type WorkspaceSourceInfo = {
    kind: "standard-database"
    convertedAt: number
    snapshotPath: string
}

export type WorkspaceManifestPaths = {
    databaseSnapshot: string
    rootSettings: string
    bots: string
    botPresets: string
    modules: string
    plugins: string
    pluginStorage: string
    botsIndex: string
}

export type WorkspaceDataFile<TData, TFormat extends WorkspaceFormatName = WorkspaceFormatName> = {
    format: TFormat
    version: typeof workspaceFormatVersion
    id?: string
    createdAt: number
    updatedAt: number
    data: TData
}

export type WorkspaceIndexItem = {
    id: string
    name?: string
    path: string
    updatedAt?: number
}

export type WorkspaceIndexFile<
    TItem extends WorkspaceIndexItem = WorkspaceIndexItem,
    TFormat extends WorkspaceIndexFormatName = "risu.index.bots"
> = WorkspaceDataFile<{
    items: TItem[]
}, TFormat>

export function createWorkspaceManifest(arg: {
    id: string
    now?: number
    source?: WorkspaceSourceInfo
}): WorkspaceManifest {
    const now = arg.now ?? Date.now()

    return {
        format: "risu.workspace",
        version: workspaceFormatVersion,
        id: arg.id,
        createdAt: now,
        updatedAt: now,
        storageKind: "workspace-directory",
        source: arg.source,
        paths: createWorkspaceManifestPaths()
    }
}

export function createWorkspaceDataFile<TData, TFormat extends WorkspaceFormatName>(arg: {
    format: TFormat
    data: TData
    id?: string
    now?: number
}): WorkspaceDataFile<TData, TFormat> {
    const now = arg.now ?? Date.now()

    return {
        format: arg.format,
        version: workspaceFormatVersion,
        id: arg.id,
        createdAt: now,
        updatedAt: now,
        data: arg.data
    }
}

export function createWorkspaceManifestPaths(): WorkspaceManifestPaths {
    return {
        databaseSnapshot: joinWorkspacePath(workspaceDirectoryNames.database, workspaceFileNames.databaseSnapshot),
        rootSettings: joinWorkspacePath(workspaceDirectoryNames.settings, workspaceFileNames.rootSettings),
        bots: workspaceDirectoryNames.bots,
        botPresets: joinWorkspacePath(workspaceDirectoryNames.presets, workspaceFileNames.botPresets),
        modules: joinWorkspacePath(workspaceDirectoryNames.modules, workspaceFileNames.modules),
        plugins: joinWorkspacePath(workspaceDirectoryNames.plugins, workspaceFileNames.pluginsIndex),
        pluginStorage: joinWorkspacePath(workspaceDirectoryNames.plugins, workspaceFileNames.pluginStorageIndex),
        botsIndex: joinWorkspacePath(workspaceDirectoryNames.indexes, workspaceFileNames.botsIndex)
    }
}

export function getWorkspaceBotDirectoryPath(botId: string) {
    return joinWorkspacePath(workspaceDirectoryNames.bots, toWorkspacePathSegment(botId))
}

export function getWorkspaceBotFilePath(botId: string) {
    return joinWorkspacePath(getWorkspaceBotDirectoryPath(botId), workspaceFileNames.bot)
}

export function getWorkspaceBotResourceDirectoryPath(botId: string, resourceDirectoryName: string) {
    return joinWorkspacePath(getWorkspaceBotDirectoryPath(botId), resourceDirectoryName)
}

export function getWorkspaceNestedBotResourceDirectoryPath(botId: string, firstDirectoryName: string, secondDirectoryName: string) {
    return joinWorkspacePath(getWorkspaceBotDirectoryPath(botId), firstDirectoryName, secondDirectoryName)
}

export function getWorkspaceBotResourceIndexPath(botId: string, resourceDirectoryName: string, indexFileName: string) {
    return joinWorkspacePath(getWorkspaceBotResourceDirectoryPath(botId, resourceDirectoryName), indexFileName)
}

export function getWorkspaceNestedBotResourceIndexPath(botId: string, firstDirectoryName: string, secondDirectoryName: string, indexFileName: string) {
    return joinWorkspacePath(getWorkspaceNestedBotResourceDirectoryPath(botId, firstDirectoryName, secondDirectoryName), indexFileName)
}

export function getWorkspaceChatIndexPath(botId: string) {
    return getWorkspaceBotResourceIndexPath(botId, workspaceBotDirectoryNames.chats, workspaceFileNames.chatsIndex)
}

export function getWorkspaceChatFilePath(botId: string, chatId: string) {
    return joinWorkspacePath(
        getWorkspaceBotResourceDirectoryPath(botId, workspaceBotDirectoryNames.chats),
        `${toWorkspacePathSegment(chatId)}.risuchat`
    )
}

export function getWorkspaceRegexIndexPath(botId: string) {
    return getWorkspaceNestedBotResourceIndexPath(botId, workspaceBotDirectoryNames.script, workspaceBotDirectoryNames.scriptRegex, workspaceFileNames.regexIndex)
}

export function getWorkspaceRegexFilePath(botId: string, regexId: string) {
    return joinWorkspacePath(
        getWorkspaceNestedBotResourceDirectoryPath(botId, workspaceBotDirectoryNames.script, workspaceBotDirectoryNames.scriptRegex),
        `${toWorkspacePathSegment(regexId)}.risuregex`
    )
}

export function getWorkspaceTriggersIndexPath(botId: string) {
    return getWorkspaceNestedBotResourceIndexPath(botId, workspaceBotDirectoryNames.script, workspaceBotDirectoryNames.scriptTriggers, workspaceFileNames.triggersIndex)
}

export function getWorkspaceTriggerFilePath(botId: string, triggerId: string) {
    return joinWorkspacePath(
        getWorkspaceNestedBotResourceDirectoryPath(botId, workspaceBotDirectoryNames.script, workspaceBotDirectoryNames.scriptTriggers),
        `${toWorkspacePathSegment(triggerId)}.risutrigger`
    )
}

export function getWorkspaceScriptBackgroundFilePath(botId: string) {
    return joinWorkspacePath(getWorkspaceBotResourceDirectoryPath(botId, workspaceBotDirectoryNames.script), workspaceFileNames.botScriptBackground)
}

export function getWorkspaceScriptVirtualFilePath(botId: string) {
    return joinWorkspacePath(getWorkspaceBotResourceDirectoryPath(botId, workspaceBotDirectoryNames.script), workspaceFileNames.botScriptVirtual)
}

export function getWorkspaceAssetFilePath(botId: string) {
    return joinWorkspacePath(getWorkspaceBotResourceDirectoryPath(botId, workspaceBotDirectoryNames.asset), workspaceFileNames.botAsset)
}

export function getWorkspaceTtsFilePath(botId: string) {
    return joinWorkspacePath(getWorkspaceBotResourceDirectoryPath(botId, workspaceBotDirectoryNames.tts), workspaceFileNames.botTts)
}

export function getWorkspaceAdvancedFilePath(botId: string) {
    return joinWorkspacePath(getWorkspaceBotResourceDirectoryPath(botId, workspaceBotDirectoryNames.advanced), workspaceFileNames.botAdvanced)
}

export function getWorkspaceLorebookIndexPath(botId: string) {
    return getWorkspaceBotResourceIndexPath(botId, workspaceBotDirectoryNames.lorebooks, workspaceFileNames.lorebooksIndex)
}

export function getWorkspaceLorebookFilePath(botId: string, lorebookId: string) {
    return joinWorkspacePath(
        getWorkspaceBotResourceDirectoryPath(botId, workspaceBotDirectoryNames.lorebooks),
        `${toWorkspacePathSegment(lorebookId)}.risulore`
    )
}

export function getWorkspacePluginFilePath(pluginId: string) {
    return joinWorkspacePath(
        workspaceDirectoryNames.plugins,
        `${toWorkspacePathSegment(pluginId)}.risuplug`
    )
}

export function getWorkspacePluginStorageDirectoryPath() {
    return joinWorkspacePath(workspaceDirectoryNames.plugins, workspacePluginDirectoryNames.storage)
}

export function getWorkspacePluginStorageFilePath(pluginId: string) {
    return joinWorkspacePath(
        getWorkspacePluginStorageDirectoryPath(),
        `${toWorkspacePathSegment(pluginId)}.risuplugstore`
    )
}

export function joinWorkspacePath(...parts: string[]) {
    return parts
        .filter((part) => part.length > 0)
        .map((part) => part.replace(/^\/+|\/+$/g, ""))
        .join("/")
}

export function toWorkspacePathSegment(value: string) {
    const normalized = value.trim()
    if(!normalized){
        throw new Error("Workspace path segment cannot be empty")
    }

    return encodeURIComponent(normalized).replace(/[!'()*]/g, (char) => {
        return `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    })
}

export function assertWorkspaceFormat<TFormat extends WorkspaceFormatName>(
    file: WorkspaceDataFile<unknown> | WorkspaceManifest,
    format: TFormat
) {
    if(file?.format !== format){
        throw new Error(`Invalid workspace file format: expected ${format}, got ${file?.format}`)
    }
}

export function assertWorkspaceVersion(file: { version?: number }) {
    if(file?.version !== workspaceFormatVersion){
        throw new Error(`Unsupported workspace file version: ${file?.version}`)
    }
}