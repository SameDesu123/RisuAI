import localforage from "localforage"

export type StorageMode = "standard-database" | "workspace-directory"

export type StandardDatabaseStorageConfig = {
    mode: "standard-database"
}

export type WorkspaceDirectoryStorageConfig = {
    mode: "workspace-directory"
    workspaceId: string
}

export type StorageConfig = StandardDatabaseStorageConfig | WorkspaceDirectoryStorageConfig

const storageConfigKey = "risu_storage_config_v1"
const workspaceHandleStore = localforage.createInstance({
    name: "risuaiWorkspaceHandles"
})

export function getDefaultStorageConfig(): StandardDatabaseStorageConfig {
    return {
        mode: "standard-database"
    }
}

export function readStorageConfig(): StorageConfig {
    const raw = localStorage.getItem(storageConfigKey)
    if(!raw){
        return getDefaultStorageConfig()
    }

    try {
        return normalizeStorageConfig(JSON.parse(raw))
    } catch (error) {
        console.warn("Failed to read storage config, falling back to standard database storage", error)
        return getDefaultStorageConfig()
    }
}

export function writeStorageConfig(config: StorageConfig) {
    localStorage.setItem(storageConfigKey, JSON.stringify(normalizeStorageConfig(config)))
}

export function resetStorageConfig() {
    localStorage.removeItem(storageConfigKey)
}

export function isStandardDatabaseStorage(config: StorageConfig = readStorageConfig()) {
    return config.mode === "standard-database"
}

export function isWorkspaceDirectoryStorage(config: StorageConfig = readStorageConfig()) {
    return config.mode === "workspace-directory"
}

export async function setStandardDatabaseStorageMode() {
    writeStorageConfig(getDefaultStorageConfig())
}

export async function setWorkspaceDirectoryStorageMode(workspaceId: string, handle: FileSystemDirectoryHandle) {
    await saveWorkspaceDirectoryHandle(workspaceId, handle)
    writeStorageConfig({
        mode: "workspace-directory",
        workspaceId
    })
}

export async function saveWorkspaceDirectoryHandle(workspaceId: string, handle: FileSystemDirectoryHandle) {
    await workspaceHandleStore.setItem(getWorkspaceHandleKey(workspaceId), handle)
}

export async function getWorkspaceDirectoryHandle(workspaceId: string): Promise<FileSystemDirectoryHandle | null> {
    return await workspaceHandleStore.getItem(getWorkspaceHandleKey(workspaceId))
}

export async function removeWorkspaceDirectoryHandle(workspaceId: string) {
    await workspaceHandleStore.removeItem(getWorkspaceHandleKey(workspaceId))
}

export function createWorkspaceId() {
    if(globalThis.crypto?.randomUUID){
        return `workspace_${globalThis.crypto.randomUUID()}`
    }
    return `workspace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function getWorkspaceHandleKey(workspaceId: string) {
    return `workspaceHandle:${workspaceId}`
}

function normalizeStorageConfig(config: any): StorageConfig {
    if(config?.mode === "workspace-directory" && typeof config.workspaceId === "string" && config.workspaceId.length > 0){
        return {
            mode: "workspace-directory",
            workspaceId: config.workspaceId
        }
    }

    return getDefaultStorageConfig()
}
