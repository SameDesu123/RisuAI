import type { Database } from "../database.svelte"
import {
    createWorkspaceDataFile,
    createWorkspaceManifest,
    getWorkspaceAdvancedFilePath,
    getWorkspaceAssetFilePath,
    getWorkspaceBotFilePath,
    getWorkspaceChatFilePath,
    getWorkspaceChatIndexPath,
    getWorkspaceLorebookFilePath,
    getWorkspaceLorebookIndexPath,
    getWorkspacePluginFilePath,
    getWorkspacePluginStorageFilePath,
    getWorkspaceRegexFilePath,
    getWorkspaceRegexIndexPath,
    getWorkspaceScriptBackgroundFilePath,
    getWorkspaceScriptVirtualFilePath,
    getWorkspaceTriggerFilePath,
    getWorkspaceTriggersIndexPath,
    getWorkspaceTtsFilePath,
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

const botAssetKeys = [
    "image",
    "emotionImages",
    "sdData",
    "additionalAssets",
    "ccAssets",
    "largePortrait",
    "inlayViewScreen",
    "prebuiltAssetCommand",
    "prebuiltAssetStyle",
    "prebuiltAssetExclude"
] as const

const botTtsKeys = [
    "ttsMode",
    "ttsSpeech",
    "voicevoxConfig",
    "naittsConfig",
    "gptSoVitsConfig",
    "fishSpeechConfig",
    "ttsReadOnlyQuoted",
    "oaiVoice",
    "oaiTTSConfig",
    "hfTTS",
    "vits"
] as const

const botBackgroundScriptKeys = [
    "backgroundHTML",
    "backgroundCSS"
] as const

const botVirtualScriptKeys = [
    "virtualscript",
    "scriptstate"
] as const

const botAdvancedKeys = [
    "utilityBot",
    "loreSettings",
    "loreExt",
    "additionalData",
    "realmId",
    "imported",
    "trashTime",
    "private",
    "source",
    "creation_date",
    "modification_date",
    "defaultVariables",
    "lowLevelAccess",
    "hideChatIcon",
    "lastInteraction",
    "translatorNote",
    "doNotChangeSeperateModels",
    "escapeOutput",
    "modules",
    "coldstorage",
    "coldStoragedChats",
    "depth_prompt",
    "lorePlus"
] as const

const splitBotKeys = new Set([
    "chats",
    "customscript",
    "triggerscript",
    "globalLore",
    ...botAssetKeys,
    ...botTtsKeys,
    ...botBackgroundScriptKeys,
    ...botVirtualScriptKeys,
    ...botAdvancedKeys
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

    await writeWorkspacePlugins(workspaceRoot, manifest, (database as any).plugins ?? [], now)
    await writeWorkspacePluginStorage(workspaceRoot, manifest, (database as any).pluginCustomStorage ?? {}, now)

    const characters = Array.isArray((database as any).characters) ? (database as any).characters : []
    const botIndexItems: WorkspaceIndexItem[] = []

    for(let i = 0; i < characters.length; i++){
        const character = characters[i]
        const botId = getWorkspaceCharacterId(character, i)
        const path = getWorkspaceBotFilePath(botId)

        await writeWorkspaceBotResources(workspaceRoot, botId, character, now)
        await writeWorkspaceJsonFile(
            workspaceRoot,
            path,
            createWorkspaceDataFile({
                format: "risu.bot",
                id: botId,
                data: getWorkspaceBotData(character),
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
        const bot = botFile.data
        await readWorkspaceBotResources(workspaceRoot, item.id, bot)
        ;(database as any).characters.push(bot)
    }

    const botPresets = await readOptionalWorkspaceDataFile<any[]>(workspaceRoot, manifest.paths.botPresets, "risu.botPresets")
    const modules = await readOptionalWorkspaceDataFile<any[]>(workspaceRoot, manifest.paths.modules, "risu.modules")

    ;(database as any).botPresets = botPresets?.data ?? []
    ;(database as any).modules = modules?.data ?? []
    ;(database as any).plugins = await readWorkspacePlugins(workspaceRoot, manifest)
    ;(database as any).pluginCustomStorage = await readWorkspacePluginStorage(workspaceRoot, manifest)

    return database
}

export async function readWorkspaceManifest(workspaceRoot: FileSystemDirectoryHandle): Promise<WorkspaceManifest> {
    const manifest = await readWorkspaceJsonFile<WorkspaceManifest>(workspaceRoot, workspaceManifestFileName)
    assertWorkspaceFormat(manifest, "risu.workspace")
    assertWorkspaceVersion(manifest)
    return manifest
}

async function writeWorkspacePlugins(workspaceRoot: FileSystemDirectoryHandle, manifest: WorkspaceManifest, plugins: any[], now: number) {
    const items: WorkspaceIndexItem[] = []
    const values = Array.isArray(plugins) ? plugins : []

    for(let i = 0; i < values.length; i++){
        const plugin = values[i]
        const id = getWorkspacePluginId(plugin, i)
        const path = getWorkspacePluginFilePath(id)

        await writeWorkspaceJsonFile(
            workspaceRoot,
            path,
            createWorkspaceDataFile({
                format: "risu.plugin",
                id,
                data: plugin,
                now
            })
        )

        items.push({
            id,
            name: getWorkspacePluginName(plugin),
            path,
            updatedAt: now
        })
    }

    await writeWorkspaceJsonFile(
        workspaceRoot,
        manifest.paths.plugins,
        createWorkspaceDataFile({
            format: "risu.index.plugins",
            data: { items },
            now
        })
    )
}

async function readWorkspacePlugins(workspaceRoot: FileSystemDirectoryHandle, manifest: WorkspaceManifest) {
    const index = await readOptionalWorkspaceDataFile<{ items: WorkspaceIndexItem[] }>(
        workspaceRoot,
        manifest.paths.plugins,
        "risu.index.plugins"
    )

    if(!index){
        const legacy = await readOptionalWorkspaceDataFile<any[]>(workspaceRoot, manifest.paths.plugins, "risu.plugins")
        return legacy?.data ?? []
    }

    const plugins: any[] = []
    for(const item of index.data.items){
        const file = await readWorkspaceDataFile<any>(workspaceRoot, item.path, "risu.plugin")
        plugins.push(file.data)
    }

    return plugins
}

async function writeWorkspacePluginStorage(workspaceRoot: FileSystemDirectoryHandle, manifest: WorkspaceManifest, pluginStorage: Record<string, unknown>, now: number) {
    const storage = isPlainObject(pluginStorage) ? pluginStorage : {}
    const items: WorkspaceIndexItem[] = []

    for(const pluginId of Object.keys(storage)){
        const path = getWorkspacePluginStorageFilePath(pluginId)
        await writeWorkspaceJsonFile(
            workspaceRoot,
            path,
            createWorkspaceDataFile({
                format: "risu.pluginStorage.entry",
                id: pluginId,
                data: storage[pluginId],
                now
            })
        )

        items.push({
            id: pluginId,
            path,
            updatedAt: now
        })
    }

    await writeWorkspaceJsonFile(
        workspaceRoot,
        manifest.paths.pluginStorage,
        createWorkspaceDataFile({
            format: "risu.index.pluginStorage",
            data: { items },
            now
        })
    )
}

async function readWorkspacePluginStorage(workspaceRoot: FileSystemDirectoryHandle, manifest: WorkspaceManifest) {
    const index = await readOptionalWorkspaceDataFile<{ items: WorkspaceIndexItem[] }>(
        workspaceRoot,
        manifest.paths.pluginStorage,
        "risu.index.pluginStorage"
    )

    if(!index){
        const legacy = await readOptionalWorkspaceDataFile<Record<string, unknown>>(workspaceRoot, manifest.paths.pluginStorage, "risu.pluginStorage")
        return legacy?.data ?? {}
    }

    const storage: Record<string, unknown> = {}
    for(const item of index.data.items){
        const file = await readWorkspaceDataFile<unknown>(workspaceRoot, item.path, "risu.pluginStorage.entry")
        storage[item.id] = file.data
    }

    return storage
}

async function writeWorkspaceBotResources(workspaceRoot: FileSystemDirectoryHandle, botId: string, character: any, now: number) {
    await writeWorkspaceBotResourceList(workspaceRoot, {
        botId,
        values: Array.isArray(character?.chats) ? character.chats : [],
        indexPath: getWorkspaceChatIndexPath(botId),
        getFilePath: getWorkspaceChatFilePath,
        format: "risu.chat",
        fallbackPrefix: "chat",
        now
    })

    await writeWorkspaceBotResourceList(workspaceRoot, {
        botId,
        values: Array.isArray(character?.customscript) ? character.customscript : [],
        indexPath: getWorkspaceRegexIndexPath(botId),
        getFilePath: getWorkspaceRegexFilePath,
        format: "risu.regex",
        fallbackPrefix: "regex",
        now
    })

    await writeWorkspaceBotResourceList(workspaceRoot, {
        botId,
        values: Array.isArray(character?.triggerscript) ? character.triggerscript : [],
        indexPath: getWorkspaceTriggersIndexPath(botId),
        getFilePath: getWorkspaceTriggerFilePath,
        format: "risu.trigger",
        fallbackPrefix: "trigger",
        now
    })

    await writeWorkspaceBotResourceList(workspaceRoot, {
        botId,
        values: Array.isArray(character?.globalLore) ? character.globalLore : [],
        indexPath: getWorkspaceLorebookIndexPath(botId),
        getFilePath: getWorkspaceLorebookFilePath,
        format: "risu.lorebook",
        fallbackPrefix: "lorebook",
        now
    })

    await writeWorkspaceBotSection(workspaceRoot, getWorkspaceAssetFilePath(botId), "risu.bot.asset", pickWorkspaceFields(character, botAssetKeys), now)
    await writeWorkspaceBotSection(workspaceRoot, getWorkspaceTtsFilePath(botId), "risu.bot.tts", pickWorkspaceFields(character, botTtsKeys), now)
    await writeWorkspaceBotSection(workspaceRoot, getWorkspaceScriptBackgroundFilePath(botId), "risu.bot.script.background", pickWorkspaceFields(character, botBackgroundScriptKeys), now)
    await writeWorkspaceBotSection(workspaceRoot, getWorkspaceScriptVirtualFilePath(botId), "risu.bot.script.virtual", pickWorkspaceFields(character, botVirtualScriptKeys), now)
    await writeWorkspaceBotSection(workspaceRoot, getWorkspaceAdvancedFilePath(botId), "risu.bot.advanced", pickWorkspaceFields(character, botAdvancedKeys), now)
}

async function writeWorkspaceBotResourceList(argWorkspaceRoot: FileSystemDirectoryHandle, arg: {
    botId: string
    values: any[]
    indexPath: string
    getFilePath: (botId: string, id: string) => string
    format: "risu.chat" | "risu.regex" | "risu.trigger" | "risu.lorebook"
    fallbackPrefix: string
    now: number
}) {
    const items: WorkspaceIndexItem[] = []

    for(let i = 0; i < arg.values.length; i++){
        const value = arg.values[i]
        const id = getWorkspaceResourceId(value, i, arg.fallbackPrefix)
        const path = arg.getFilePath(arg.botId, id)

        await writeWorkspaceJsonFile(
            argWorkspaceRoot,
            path,
            createWorkspaceDataFile({
                format: arg.format,
                id,
                data: value,
                now: arg.now
            })
        )

        items.push({
            id,
            name: getWorkspaceResourceName(value),
            path,
            updatedAt: arg.now
        })
    }

    await writeWorkspaceJsonFile(
        argWorkspaceRoot,
        arg.indexPath,
        createWorkspaceDataFile({
            format: getIndexFormatForResourceFormat(arg.format),
            data: { items },
            now: arg.now
        })
    )
}

async function writeWorkspaceBotSection(
    workspaceRoot: FileSystemDirectoryHandle,
    path: string,
    format: "risu.bot.asset" | "risu.bot.tts" | "risu.bot.script.background" | "risu.bot.script.virtual" | "risu.bot.advanced",
    data: Record<string, unknown>,
    now: number
) {
    await writeWorkspaceJsonFile(
        workspaceRoot,
        path,
        createWorkspaceDataFile({
            format,
            data,
            now
        })
    )
}

async function readWorkspaceBotResources(workspaceRoot: FileSystemDirectoryHandle, botId: string, bot: any) {
    bot.chats = await readWorkspaceBotResourceList(workspaceRoot, {
        indexPath: getWorkspaceChatIndexPath(botId),
        format: "risu.chat",
        fallback: Array.isArray(bot.chats) ? bot.chats : []
    })

    bot.customscript = await readWorkspaceBotResourceList(workspaceRoot, {
        indexPath: getWorkspaceRegexIndexPath(botId),
        format: "risu.regex",
        fallback: Array.isArray(bot.customscript) ? bot.customscript : []
    })

    bot.triggerscript = await readWorkspaceBotResourceList(workspaceRoot, {
        indexPath: getWorkspaceTriggersIndexPath(botId),
        format: "risu.trigger",
        fallback: Array.isArray(bot.triggerscript) ? bot.triggerscript : []
    })

    bot.globalLore = await readWorkspaceBotResourceList(workspaceRoot, {
        indexPath: getWorkspaceLorebookIndexPath(botId),
        format: "risu.lorebook",
        fallback: Array.isArray(bot.globalLore) ? bot.globalLore : []
    })

    await mergeWorkspaceBotSection(workspaceRoot, bot, getWorkspaceAssetFilePath(botId), "risu.bot.asset")
    await mergeWorkspaceBotSection(workspaceRoot, bot, getWorkspaceTtsFilePath(botId), "risu.bot.tts")
    await mergeWorkspaceBotSection(workspaceRoot, bot, getWorkspaceScriptBackgroundFilePath(botId), "risu.bot.script.background")
    await mergeWorkspaceBotSection(workspaceRoot, bot, getWorkspaceScriptVirtualFilePath(botId), "risu.bot.script.virtual")
    await mergeWorkspaceBotSection(workspaceRoot, bot, getWorkspaceAdvancedFilePath(botId), "risu.bot.advanced")
}

async function readWorkspaceBotResourceList(workspaceRoot: FileSystemDirectoryHandle, arg: {
    indexPath: string
    format: "risu.chat" | "risu.regex" | "risu.trigger" | "risu.lorebook"
    fallback: any[]
}) {
    const index = await readOptionalWorkspaceDataFile<{ items: WorkspaceIndexItem[] }>(
        workspaceRoot,
        arg.indexPath,
        getIndexFormatForResourceFormat(arg.format)
    )

    if(!index){
        return arg.fallback
    }

    const values: any[] = []
    for(const item of index.data.items){
        const file = await readWorkspaceDataFile<any>(workspaceRoot, item.path, arg.format)
        values.push(file.data)
    }

    return values
}

async function mergeWorkspaceBotSection(
    workspaceRoot: FileSystemDirectoryHandle,
    bot: any,
    path: string,
    format: "risu.bot.asset" | "risu.bot.tts" | "risu.bot.script.background" | "risu.bot.script.virtual" | "risu.bot.advanced"
) {
    const file = await readOptionalWorkspaceDataFile<Record<string, unknown>>(workspaceRoot, path, format)
    if(file){
        Object.assign(bot, file.data)
    }
}

function getIndexFormatForResourceFormat(format: "risu.chat" | "risu.regex" | "risu.trigger" | "risu.lorebook") {
    if(format === "risu.chat"){
        return "risu.index.chats"
    }
    if(format === "risu.regex"){
        return "risu.index.regex"
    }
    if(format === "risu.trigger"){
        return "risu.index.triggers"
    }
    return "risu.index.lorebooks"
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

function getWorkspaceBotData(character: any): Record<string, unknown> {
    const botData: Record<string, unknown> = {}
    for(const key of Object.keys(character ?? {})){
        if(splitBotKeys.has(key)){
            continue
        }
        botData[key] = character[key]
    }
    return botData
}

function pickWorkspaceFields(source: any, keys: readonly string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for(const key of keys){
        if(source?.[key] !== undefined){
            result[key] = source[key]
        }
    }
    return result
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

function getWorkspaceResourceId(value: any, index: number, fallbackPrefix: string) {
    if(typeof value?.id === "string" && value.id.length > 0){
        return value.id
    }
    if(typeof value?.chatId === "string" && value.chatId.length > 0){
        return value.chatId
    }
    if(typeof value?.name === "string" && value.name.length > 0){
        return `${fallbackPrefix}_${index}_${value.name}`
    }
    if(typeof value?.comment === "string" && value.comment.length > 0){
        return `${fallbackPrefix}_${index}_${value.comment}`
    }
    return `${fallbackPrefix}_${index}`
}

function getWorkspaceResourceName(value: any) {
    if(typeof value?.name === "string" && value.name.length > 0){
        return value.name
    }
    if(typeof value?.comment === "string" && value.comment.length > 0){
        return value.comment
    }
    return undefined
}

function getWorkspacePluginId(plugin: any, index: number) {
    if(typeof plugin?.id === "string" && plugin.id.length > 0){
        return plugin.id
    }
    if(typeof plugin?.name === "string" && plugin.name.length > 0){
        return plugin.name
    }
    return `plugin_${index}`
}

function getWorkspacePluginName(plugin: any) {
    if(typeof plugin?.name === "string" && plugin.name.length > 0){
        return plugin.name
    }
    if(typeof plugin?.id === "string" && plugin.id.length > 0){
        return plugin.id
    }
    return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value))
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
    await writable.write(toWritableArrayBuffer(value))
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

function toWritableArrayBuffer(data: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(buffer).set(data)
    return buffer
}

function isNotFoundError(error: unknown) {
    return error instanceof DOMException && error.name === "NotFoundError"
}