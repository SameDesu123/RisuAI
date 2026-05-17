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

export const workspaceFileNames = {
    databaseSnapshot: "source.database.bin",
    rootSettings: "root.risuset",
    bot: "bot.risubot",
    botPresets: "botPresets.risupreset",
    modules: "modules.risumodule",
    plugins: "plugins.risuplug",
    pluginStorage: "pluginStorage.risuplugstore",
    botsIndex: "bots.risuindex"
} as const

export type WorkspaceFormatName =
    | "risu.workspace"
    | "risu.settings.root"
    | "risu.bot"
    | "risu.botPresets"
    | "risu.modules"
    | "risu.plugins"
    | "risu.pluginStorage"
    | "risu.index.bots"

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

export type WorkspaceIndexFile<TItem extends WorkspaceIndexItem = WorkspaceIndexItem> = WorkspaceDataFile<{
    items: TItem[]
}, "risu.index.bots">

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
        plugins: joinWorkspacePath(workspaceDirectoryNames.plugins, workspaceFileNames.plugins),
        pluginStorage: joinWorkspacePath(workspaceDirectoryNames.plugins, workspaceFileNames.pluginStorage),
        botsIndex: joinWorkspacePath(workspaceDirectoryNames.indexes, workspaceFileNames.botsIndex)
    }
}

export function getWorkspaceBotDirectoryPath(botId: string) {
    return joinWorkspacePath(workspaceDirectoryNames.bots, toWorkspacePathSegment(botId))
}

export function getWorkspaceBotFilePath(botId: string) {
    return joinWorkspacePath(getWorkspaceBotDirectoryPath(botId), workspaceFileNames.bot)
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
