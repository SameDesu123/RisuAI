import type { Database } from "../database.svelte"
import {
    createWorkspaceDataFile,
    createWorkspaceManifest,
    getWorkspaceBotFilePath,
    joinWorkspacePath,
    workspaceDirectoryNames,
    workspaceFileNames,
    workspaceManifestFileName,
    assertWorkspaceFormat,
    assertWorkspaceVersion,
    type WorkspaceDataFile,
    type WorkspaceIndexFile,
    type WorkspaceIndexItem,
    type WorkspaceManifest,
    type WorkspaceSourceInfo,
} from "./workspaceFormat"

export type WorkspaceWriteOptions = {
    workspaceId: string
    sourceDatabaseBin?: Uint8Array | ArrayBuffer
    now?: number
}

export type WorkspaceReadOptions = {
    allowMissingIndex?: boolean
}

const rootDatabaseKeys = new Set([
    "characters",
    "botPresets",
    "modules",
    "plugins",
    "pluginCustomStorage"
])

export async function writeWorkspaceDatabase(
    workspaceRoot: FileSystemDirectoryHandle,
    database: Database,
    options: WorkspaceWriteOptions
): Promise<WorkspaceManifest> {
    const now = options.now ?? Date.now()
    await ensureWorkspaceDirectories(workspaceRoot)

    let source: WorkspaceSourceInfo | undefined
    if(options.sourceDatabaseBin){
        const snapshotPath = joinWorkspacePath(workspaceDirectoryNames.database, workspaceFileNames.databaseSnapshot)
        await writeWorkspaceBinaryFile(workspaceRoot, snapshotPath, toUint8Array(options.sourceDatabaseBin))
        source = {
            kind: "standard-database",
            convertedAt: now,
            snapshotPath
        }
    }

    const manifest = createWorkspaceManifest({
        id: options.workspaceId,
        now,
        source
    })

    await writeWorkspaceJsonFile(workspaceRoot, workspaceManifestFileName, manifest)
    await writeWorkspaceJsonFile(
        workspaceRoot,
        manifest.paths.rootSettings,
        createWorkspaceDataFile({
            format: "risu.settings.root",
            data: getWorkspaceRootSettings(database),
            now
        })
    )

    await writeWorkspaceJsonFile(
        workspaceRoot,
        manifest.paths.botPresets,
        createWorkspaceDataFile({
            format: "risu.botPresets",
            data: (database as any).botPresets ?? [],
            now
        })
    )

    await writeWorkspaceJsonFile(
        workspaceRoot,
        manifest.paths.modules,
        createWorkspaceDataFile({
            format: "risu.modules",
            data: (database as any).modules ?? [],
            now
        })
    )

    await writeWorkspaceJsonFile(
        workspaceRoot,
        manifest.paths.plugins,
        createWorkspaceDataFile({
            format: "risu.plugins",
            data: (database as any).plugins ?? [],
            now
        })
    )

    await writeWorkspaceJsonFile(
        workspaceRoot,
        manifest.paths.pluginStorage,
        createWorkspaceDataFile({
            format: "risu.pluginStorage",
            data: (database as any).pluginCustomStorage ?? {},
            now
        })
    )

    const characters = Array.isArray((database as any).characters) ? (database as any).characters : []
    const botIndexItems: WorkspaceIndexItem[] = []

    for(let i = 0; i < characters.length; i++){
        const character = characters[i]
        const botId = getWorkspaceCharacterId(character, i)
        const path = getWorkspaceBotFilePath(botId)

        await writeWorkspaceJsonFile(
            workspaceRoot,
            path,
            createWorkspaceDataFile({
                format: "risu.bot",
                id: botId,
                data: character,
                now
            })
        )

        botIndexItems.push({
            id: botId,
            name: getWorkspaceCharacterName(character),
            path,
            updatedAt: now
        })
    }

    const botsIndex: WorkspaceIndexFile = createWorkspaceDataFile({
        format: "risu.index.bots",
        data: {
            items: botIndexItems
        },
        now
    })

    await writeWorkspaceJsonFile(workspaceRoot, manifest.paths.botsIndex, botsIndex)

    return manifest
}

export async function readWorkspaceDatabase(
    workspaceRoot: FileSystemDirectoryHandle,
    options: WorkspaceReadOptions = {}
): Promise<Database> {
    const manifest = await readWorkspaceManifest(workspaceRoot)
    const rootSettings = await readWorkspaceDataFile<Record<string, unknown>>(
        workspaceRoot,
        manifest.paths.rootSettings,
        "risu.settings.root"
    )

    const database: Database = {
        ...(rootSettings.data as any)
    }

    const botIndex = await readWorkspaceBotsIndex(workspaceRoot, manifest, options)
    ;(database as any).characters = []

    for(const item of botIndex.data.items){
        const botFile = await readWorkspaceDataFile<any>(workspaceRoot, item.path, "risu.bot")
        ;(database as any).characters.push(botFile.data)
    }

    const botPresets = await readOptionalWorkspaceDataFile<any[]>(workspaceRoot, manifest.paths.botPresets, "risu.botPresets")
    const modules = await readOptionalWorkspaceDataFile<any[]>(workspaceRoot, manifest.paths.modules, "risu.modules")
    const plugins = await readOptionalWorkspaceDataFile<any[]>(workspaceRoot, manifest.paths.plugins, "risu.plugins")
    const pluginStorage = await readOptionalWorkspaceDataFile<Record<string, unknown>>(workspaceRoot, manifest.paths.pluginStorage, "risu.pluginStorage")

    ;(database as any).botPresets = botPresets?.data ?? []
    ;(database as any).modules = modules?.data ?? []
    ;(database as any).plugins = plugins?.data ?? []
    ;(database as any).pluginCustomStorage = pluginStorage?.data ?? {}

    return database
}

export async function readWorkspaceManifest(workspaceRoot: FileSystemDirectoryHandle): Promise<WorkspaceManifest> {
    const manifest = await readWorkspaceJsonFile<WorkspaceManifest>(workspaceRoot, workspaceManifestFileName)
    assertWorkspaceFormat(manifest, "risu.workspace")
    assertWorkspaceVersion(manifest)
    return manifest
}

async function readWorkspaceBotsIndex(
    workspaceRoot: FileSystemDirectoryHandle,
    manifest: WorkspaceManifest,
    options: WorkspaceReadOptions
): Promise<WorkspaceIndexFile> {
    const index = await readOptionalWorkspaceDataFile<{ items: WorkspaceIndexItem[] }>(
        workspaceRoot,
        manifest.paths.botsIndex,
        "risu.index.bots"
    )

    if(index){
        return index as WorkspaceIndexFile
    }

    if(options.allowMissingIndex){
        return createWorkspaceDataFile({
            format: "risu.index.bots",
            data: {
                items: await discoverWorkspaceBotIndexItems(workspaceRoot)
            }
        })
    }

    throw new Error("Workspace bots index is missing")
}

async function discoverWorkspaceBotIndexItems(workspaceRoot: FileSystemDirectoryHandle): Promise<WorkspaceIndexItem[]> {
    const botsDirectory = await getWorkspaceDirectoryHandleByPath(workspaceRoot, workspaceDirectoryNames.bots, false)
    if(!botsDirectory){
        return []
    }

    const items: WorkspaceIndexItem[] = []
    for await (const entry of botsDirectory.values()){
        if(entry.kind !== "directory"){
            continue
        }

        const path = joinWorkspacePath(workspaceDirectoryNames.bots, entry.name, workspaceFileNames.bot)
        items.push({
            id: decodeURIComponent(entry.name),
            path
        })
    }

    return items
}

async function readWorkspaceDataFile<TData>(
    workspaceRoot: FileSystemDirectoryHandle,
    path: string,
    format: WorkspaceDataFile<TData>["format"]
): Promise<WorkspaceDataFile<TData>> {
    const file = await readWorkspaceJsonFile<WorkspaceDataFile<TData>>(workspaceRoot, path)
    assertWorkspaceFormat(file, format)
    assertWorkspaceVersion(file)
    return file
}

async function readOptionalWorkspaceDataFile<TData>(
    workspaceRoot: FileSystemDirectoryHandle,
    path: string,
    format: WorkspaceDataFile<TData>["format"]
): Promise<WorkspaceDataFile<TData> | null> {
    try {
        return await readWorkspaceDataFile<TData>(workspaceRoot, path, format)
    } catch (error) {
        if(isNotFoundError(error)){
            return null
        }
        throw error
    }
}

function getWorkspaceRootSettings(database: Database): Record<string, unknown> {
    const rootSettings: Record<string, unknown> = {}
    for(const key of Object.keys(database as any)){
        if(rootDatabaseKeys.has(key)){
            continue
        }
        rootSettings[key] = (database as any)[key]
    }
    return rootSettings
}

function getWorkspaceCharacterId(character: any, index: number) {
    if(typeof character?.chaId === "string" && character.chaId.length > 0){
        return character.chaId
    }
    if(typeof character?.id === "string" && character.id.length > 0){
        return character.id
    }
    return `character_${index}`
}

function getWorkspaceCharacterName(character: any) {
    if(typeof character?.name === "string" && character.name.length > 0){
        return character.name
    }
    if(typeof character?.nickname === "string" && character.nickname.length > 0){
        return character.nickname
    }
    return undefined
}

async function ensureWorkspaceDirectories(workspaceRoot: FileSystemDirectoryHandle) {
    for(const directory of Object.values(workspaceDirectoryNames)){
        await workspaceRoot.getDirectoryHandle(directory, {
            create: true
        })
    }
}

async function writeWorkspaceJsonFile(workspaceRoot: FileSystemDirectoryHandle, path: string, value: unknown) {
    await writeWorkspaceTextFile(workspaceRoot, path, JSON.stringify(value, null, 2))
}

async function readWorkspaceJsonFile<TValue>(workspaceRoot: FileSystemDirectoryHandle, path: string): Promise<TValue> {
    const text = await readWorkspaceTextFile(workspaceRoot, path)
    return JSON.parse(text) as TValue
}

async function writeWorkspaceTextFile(workspaceRoot: FileSystemDirectoryHandle, path: string, value: string) {
    const handle = await getWorkspaceFileHandleByPath(workspaceRoot, path, true)
    const writable = await handle.createWritable()
    await writable.write(value)
    await writable.close()
}

async function readWorkspaceTextFile(workspaceRoot: FileSystemDirectoryHandle, path: string) {
    const handle = await getWorkspaceFileHandleByPath(workspaceRoot, path, false)
    const file = await handle.getFile()
    return await file.text()
}

async function writeWorkspaceBinaryFile(workspaceRoot: FileSystemDirectoryHandle, path: string, value: Uint8Array) {
    const handle = await getWorkspaceFileHandleByPath(workspaceRoot, path, true)
    const writable = await handle.createWritable()
    await writable.write(value)
    await writable.close()
}

async function getWorkspaceFileHandleByPath(
    workspaceRoot: FileSystemDirectoryHandle,
    path: string,
    create: boolean
): Promise<FileSystemFileHandle> {
    const parts = splitWorkspacePath(path)
    const fileName = parts.pop()
    if(!fileName){
        throw new Error(`Invalid workspace file path: ${path}`)
    }

    const directory = await getWorkspaceDirectoryHandleByPath(workspaceRoot, parts.join("/"), create)
    if(!directory){
        throw new DOMException(`Workspace directory not found: ${path}`, "NotFoundError")
    }

    return await directory.getFileHandle(fileName, {
        create
    })
}

async function getWorkspaceDirectoryHandleByPath(
    workspaceRoot: FileSystemDirectoryHandle,
    path: string,
    create: boolean
): Promise<FileSystemDirectoryHandle | null> {
    const parts = splitWorkspacePath(path)
    let directory = workspaceRoot

    for(const part of parts){
        try {
            directory = await directory.getDirectoryHandle(part, {
                create
            })
        } catch (error) {
            if(isNotFoundError(error)){
                return null
            }
            throw error
        }
    }

    return directory
}

function splitWorkspacePath(path: string) {
    return path
        .split("/")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
}

function toUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
    if(data instanceof Uint8Array){
        return data
    }
    return new Uint8Array(data)
}

function isNotFoundError(error: unknown) {
    return error instanceof DOMException && error.name === "NotFoundError"
}
