import type { RisuRawStorage } from "./storageTypes"
import {
    decodeStandardDatabaseBin,
    encodeStandardDatabaseBin,
    type EncodeStandardDatabaseBinOptions,
} from "./codec/databaseBinCodec"
import { standardDatabaseBinKey } from "./converter/standardToWorkspace"
import { createWorkspaceId } from "./storageConfig"
import {
    readWorkspaceDatabase,
    readWorkspaceManifest,
    writeWorkspaceDatabase,
} from "./workspace/workspaceCodec"
import {
    getWorkspaceBotFilePath,
    workspaceDirectoryNames,
    workspaceFileNames,
    workspaceManifestFileName,
    type WorkspaceManifest,
} from "./workspace/workspaceFormat"

export type WorkspaceDirectoryStorageOptions = {
    workspaceId?: string
    databaseBinEncoding?: EncodeStandardDatabaseBinOptions
    includeRawKeysInList?: boolean
}

export class WorkspaceDirectoryStorage implements RisuRawStorage{
    private workspaceId?: string
    private databaseBinEncoding?: EncodeStandardDatabaseBinOptions
    private includeRawKeysInList: boolean

    constructor(
        private workspaceRoot: FileSystemDirectoryHandle,
        options: WorkspaceDirectoryStorageOptions = {}
    ){
        this.workspaceId = options.workspaceId
        this.databaseBinEncoding = options.databaseBinEncoding
        this.includeRawKeysInList = options.includeRawKeysInList ?? true
    }

    async setItem(key: string, value: Uint8Array) {
        if(key === standardDatabaseBinKey){
            const databaseBin = toUint8Array(value)
            const database = await decodeStandardDatabaseBin(databaseBin)
            await writeWorkspaceDatabase(this.workspaceRoot, database, {
                workspaceId: await this.getWorkspaceId(),
                sourceDatabaseBin: databaseBin
            })
            return null
        }

        await writeWorkspaceRawFile(this.workspaceRoot, key, toUint8Array(value))
        return null
    }

    async getItem(key: string): Promise<Buffer | null> {
        if(key === standardDatabaseBinKey){
            try {
                const database = await readWorkspaceDatabase(this.workspaceRoot)
                const databaseBin = await encodeStandardDatabaseBin(database, this.databaseBinEncoding)
                return Buffer.from(databaseBin)
            } catch (error) {
                if(isNotFoundError(error)){
                    return null
                }
                throw error
            }
        }

        return await readWorkspaceRawFile(this.workspaceRoot, key)
    }

    async keys(): Promise<string[]> {
        const keys = new Set<string>([standardDatabaseBinKey])

        if(this.includeRawKeysInList){
            for(const key of await listWorkspaceRawKeys(this.workspaceRoot)){
                keys.add(key)
            }
        }

        return [...keys]
    }

    async removeItem(key: string | string[]) {
        if(Array.isArray(key)){
            for(const item of key){
                await this.removeItem(item)
            }
            return null
        }

        if(key === standardDatabaseBinKey){
            throw new Error("Cannot remove the workspace standard database view")
        }

        await removeWorkspaceRawFile(this.workspaceRoot, key)
        return null
    }

    async getManifest(): Promise<WorkspaceManifest | null> {
        try {
            return await readWorkspaceManifest(this.workspaceRoot)
        } catch (error) {
            if(isNotFoundError(error)){
                return null
            }
            throw error
        }
    }

    private async getWorkspaceId() {
        if(this.workspaceId){
            return this.workspaceId
        }

        const manifest = await this.getManifest()
        this.workspaceId = manifest?.id ?? createWorkspaceId()
        return this.workspaceId
    }

    listItem = this.keys.bind(this)
}

async function writeWorkspaceRawFile(workspaceRoot: FileSystemDirectoryHandle, key: string, value: Uint8Array) {
    const handle = await getWorkspaceFileHandleByPath(workspaceRoot, key, true)
    const writable = await handle.createWritable()
    await writable.write(toWritableArrayBuffer(value))
    await writable.close()
}

async function readWorkspaceRawFile(workspaceRoot: FileSystemDirectoryHandle, key: string): Promise<Buffer | null> {
    try {
        const handle = await getWorkspaceFileHandleByPath(workspaceRoot, key, false)
        const file = await handle.getFile()
        return Buffer.from(await file.arrayBuffer())
    } catch (error) {
        if(isNotFoundError(error)){
            return null
        }
        throw error
    }
}

async function removeWorkspaceRawFile(workspaceRoot: FileSystemDirectoryHandle, key: string) {
    const parts = splitWorkspacePath(key)
    const fileName = parts.pop()
    if(!fileName){
        throw new Error(`Invalid workspace file path: ${key}`)
    }

    const directory = await getWorkspaceDirectoryHandleByPath(workspaceRoot, parts.join("/"), false)
    if(!directory){
        return null
    }

    try {
        await directory.removeEntry(fileName)
    } catch (error) {
        if(isNotFoundError(error)){
            return null
        }
        throw error
    }
}

async function listWorkspaceRawKeys(workspaceRoot: FileSystemDirectoryHandle): Promise<string[]> {
    const keys: string[] = []
    await collectWorkspaceRawKeys(workspaceRoot, "", keys)
    return keys.filter((key) => !isWorkspaceManagedKey(key))
}

async function collectWorkspaceRawKeys(
    directory: FileSystemDirectoryHandle,
    prefix: string,
    keys: string[]
) {
    for await (const entry of directory.values()){
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if(entry.kind === "directory"){
            await collectWorkspaceRawKeys(entry, path, keys)
            continue
        }

        keys.push(path)
    }
}

function isWorkspaceManagedKey(key: string) {
    if(key === workspaceManifestFileName){
        return true
    }

    if(key === `${workspaceDirectoryNames.database}/${workspaceFileNames.databaseSnapshot}`){
        return true
    }

    if(key === `${workspaceDirectoryNames.settings}/${workspaceFileNames.rootSettings}`){
        return true
    }

    if(key === `${workspaceDirectoryNames.presets}/${workspaceFileNames.botPresets}`){
        return true
    }

    if(key === `${workspaceDirectoryNames.modules}/${workspaceFileNames.modules}`){
        return true
    }

    if(key === `${workspaceDirectoryNames.plugins}/${workspaceFileNames.plugins}`){
        return true
    }

    if(key === `${workspaceDirectoryNames.plugins}/${workspaceFileNames.pluginStorage}`){
        return true
    }

    if(key === `${workspaceDirectoryNames.indexes}/${workspaceFileNames.botsIndex}`){
        return true
    }

    if(key.startsWith(`${workspaceDirectoryNames.tmp}/`)){
        return true
    }

    return isWorkspaceBotDataFileKey(key)
}

function isWorkspaceBotDataFileKey(key: string) {
    const parts = splitWorkspacePath(key)
    if(parts.length !== 3){
        return false
    }

    return key === getWorkspaceBotFilePath(decodeURIComponent(parts[1]))
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