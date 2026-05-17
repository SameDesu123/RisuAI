import type { RisuRawStorage } from "../storageTypes"
import { createWorkspaceId } from "../storageConfig"
import {
    decodeStandardDatabaseBin,
    validateStandardDatabaseBin,
} from "../codec/databaseBinCodec"
import {
    readWorkspaceDatabase,
    writeWorkspaceDatabase,
} from "../workspace/workspaceCodec"
import {
    assertWorkspaceMigrationValid,
    type WorkspaceValidationOptions,
    type WorkspaceValidationResult,
} from "../workspace/workspaceValidator"
import type { WorkspaceManifest } from "../workspace/workspaceFormat"

export const standardDatabaseBinKey = "database/database.bin"

export type StandardToWorkspaceConversionOptions = WorkspaceValidationOptions & {
    workspaceId?: string
    databaseKey?: string
    now?: number
}

export type StandardToWorkspaceConversionResult = {
    workspaceId: string
    manifest: WorkspaceManifest
    validation: WorkspaceValidationResult
}

export async function convertStandardDatabaseToWorkspace(
    sourceStorage: RisuRawStorage,
    workspaceRoot: FileSystemDirectoryHandle,
    options: StandardToWorkspaceConversionOptions = {}
): Promise<StandardToWorkspaceConversionResult> {
    const databaseKey = options.databaseKey ?? standardDatabaseBinKey
    const sourceDatabaseBin = await readStandardDatabaseBin(sourceStorage, databaseKey)
    const sourceDatabase = await decodeStandardDatabaseBin(sourceDatabaseBin)

    const workspaceId = options.workspaceId ?? createWorkspaceId()
    const manifest = await writeWorkspaceDatabase(workspaceRoot, sourceDatabase, {
        workspaceId,
        sourceDatabaseBin,
        now: options.now
    })

    const restoredDatabase = await readWorkspaceDatabase(workspaceRoot)
    const validation = assertWorkspaceMigrationValid(sourceDatabase, restoredDatabase, {
        compareSerializableValues: options.compareSerializableValues
    })

    return {
        workspaceId,
        manifest,
        validation
    }
}

export async function readStandardDatabaseBin(
    sourceStorage: RisuRawStorage,
    databaseKey = standardDatabaseBinKey
): Promise<Uint8Array> {
    const value = await sourceStorage.getItem(databaseKey)
    if(!value){
        throw new Error(`Standard database bin not found: ${databaseKey}`)
    }

    return storageValueToUint8Array(value)
}

export async function validateStandardDatabaseStorage(
    sourceStorage: RisuRawStorage,
    databaseKey = standardDatabaseBinKey
) {
    const sourceDatabaseBin = await readStandardDatabaseBin(sourceStorage, databaseKey)
    return await validateStandardDatabaseBin(sourceDatabaseBin)
}

function storageValueToUint8Array(value: unknown): Uint8Array {
    if(value instanceof Uint8Array){
        return value
    }

    if(value instanceof ArrayBuffer){
        return new Uint8Array(value)
    }

    if(ArrayBuffer.isView(value)){
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    }

    throw new Error(`Unsupported standard database storage value: ${Object.prototype.toString.call(value)}`)
}
