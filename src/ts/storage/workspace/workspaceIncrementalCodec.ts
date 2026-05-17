import type { Database } from "../database.svelte"
import type { toSaveType } from "../risuSave"
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
    type WorkspaceIndexItem,
    type WorkspaceManifest,
} from "./workspaceFormat"
import { readWorkspaceManifest, writeWorkspaceDatabase } from "./workspaceCodec"

export type WorkspaceIncrementalWriteOptions = {
    workspaceId: string
    changes?: toSaveType
    now?: number
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

export async function writeWorkspaceDatabaseIncremental(
    workspaceRoot: FileSystemDirectoryHandle,
    database: Database,
    options: WorkspaceIncrementalWriteOptions
): Promise<WorkspaceManifest> {
    if(!options.changes){
        return await writeWorkspaceDatabase(workspaceRoot, database, {
            workspaceId: options.workspaceId,
            now: options.now
        })
    }

    const now = options.now ?? Date.now()
    await ensureWorkspaceDirectories(workspaceRoot)

    const manifest = await readOrCreateManifest(workspaceRoot, options.workspaceId, now)
    manifest.updatedAt = now
    await writeWorkspaceJsonFile(workspaceRoot, workspaceManifestFileName, manifest)

    await writeWorkspaceRootSettings(workspaceRoot, manifest, database, now)
    await writeWorkspaceIndexes(workspaceRoot, manifest, database, now)

    if(options.changes.botPreset){
        await writeWorkspaceJsonFile(
            workspaceRoot,
            manifest.paths.botPresets,
            createWorkspaceDataFile({
                format: "risu.botPresets",
                data: (database as any).botPresets ?? [],
                now
            })
        )
    }

    if(options.changes.modules){
        await writeWorkspaceJsonFile(
            workspaceRoot,
            manifest.paths.modules,
            createWorkspaceDataFile({
                format: "risu.modules",
                data: (database as any).modules ?? [],
                now
            })
        )
    }

    if(options.changes.plugins){
        await writeWorkspaceJsonFile(
            workspaceRoot,
            manifest.paths.plugins,
            createWorkspaceDataFile({
                format: "risu.plugins",
                data: (database as any).plugins ?? [],
                now
            })
        )
    }

    if(options.changes.pluginCustomStorage){
        await writeWorkspaceJsonFile(
            workspaceRoot,
            manifest.paths.pluginStorage,
            createWorkspaceDataFile({
                format: "risu.pluginStorage",
                data: (database as any).pluginCustomStorage ?? {},
                now
            })
        )
    }

    const changedBotIds = getChangedBotIds(options.changes)
    for(const botId of changedBotIds){
        const character = findWorkspaceCharacter(database, botId)
        if(character){
            await writeWorkspaceBot(workspaceRoot, character, now)
        }
    }

    return manifest
}

async function readOrCreateManifest(workspaceRoot: FileSystemDirectoryHandle, workspaceId: string, now: number) {
    try {
        return await readWorkspaceManifest(workspaceRoot)
    } catch (error) {
        if(isNotFoundError(error)){
            return createWorkspaceManifest({
                id: workspaceId,
                now
            })
        }
        throw error
    }
}

async function writeWorkspaceRootSettings(
    workspaceRoot: FileSystemDirectoryHandle,
    manifest: WorkspaceManifest,
    database: Database,
    now: number
) {
    await writeWorkspaceJsonFile(
        workspaceRoot,
        manifest.paths.rootSettings,
        createWorkspaceDataFile({
            format: "risu.settings.root",
            data: getWorkspaceRootSettings(database),
            now
        })
    )
}

async function writeWorkspaceIndexes(
    workspaceRoot: FileSystemDirectoryHandle,
    manifest: WorkspaceManifest,
    database: Database,
    now: number
) {
    const characters = Array.isArray((database as any).characters) ? (database as any).characters : []
    const botIndexItems: WorkspaceIndexItem[] = []

    for(let i = 0; i < characters.length; i++){
        const character = characters[i]
        const botId = getWorkspaceCharacterId(character, i)
        botIndexItems.push({
            id: botId,
            name: getWorkspaceCharacterName(character),
            path: getWorkspaceBotFilePath(botId),
            updatedAt: now
        })
    }

    await writeWorkspaceJsonFile(
        workspaceRoot,
        manifest.paths.botsIndex,
        createWorkspaceDataFile({
            format: "risu.index.bots",
            data: { items: botIndexItems },
            now
        })
    )
}

async function writeWorkspaceBot(workspaceRoot: FileSystemDirectoryHandle, character: any, now: number) {
    const botId = getWorkspaceCharacterId(character, 0)

    await writeWorkspaceBotResources(workspaceRoot, botId, character, now)
    await writeWorkspaceJsonFile(
        workspaceRoot,
        getWorkspaceBotFilePath(botId),
        createWorkspaceDataFile({
            format: "risu.bot",
            id: botId,
            data: getWorkspaceBotData(character),
            now
        })
    )
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

function getChangedBotIds(changes: toSaveType) {
    const ids = new Set<string>()

    for(const id of changes.character){
        if(id){
            ids.add(id)
        }
    }

    for(const [botId] of changes.chat){
        if(botId){
            ids.add(botId)
        }
    }

    return ids
}

function findWorkspaceCharacter(database: Database, botId: string) {
    const characters = Array.isArray((database as any).characters) ? (database as any).characters : []
    return characters.find((character: any, index: number) => getWorkspaceCharacterId(character, index) === botId)
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

async function ensureWorkspaceDirectories(workspaceRoot: FileSystemDirectoryHandle) {
    for(const directory of Object.values(workspaceDirectoryNames)){
        await workspaceRoot.getDirectoryHandle(directory, {
            create: true
        })
    }
}

async function writeWorkspaceJsonFile(workspaceRoot: FileSystemDirectoryHandle, path: string, value: unknown) {
    const handle = await getWorkspaceFileHandleByPath(workspaceRoot, path, true)
    const writable = await handle.createWritable()
    await writable.write(JSON.stringify(value, null, 2))
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

function isNotFoundError(error: unknown) {
    return error instanceof DOMException && error.name === "NotFoundError"
}
