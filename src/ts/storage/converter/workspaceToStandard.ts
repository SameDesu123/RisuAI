import type { Database } from "../database.svelte"
import type { RisuRawStorage } from "../storageTypes"
import {
    decodeStandardDatabaseBin,
    encodeStandardDatabaseBin,
    type EncodeStandardDatabaseBinOptions,
} from "../codec/databaseBinCodec"
import { readWorkspaceDatabase } from "../workspace/workspaceCodec"
import {
    assertWorkspaceMigrationValid,
    type WorkspaceValidationOptions,
    type WorkspaceValidationResult,
} from "../workspace/workspaceValidator"
import { standardDatabaseBinKey } from "./standardToWorkspace"

export type WorkspaceToStandardConversionOptions = WorkspaceValidationOptions & EncodeStandardDatabaseBinOptions & {
    databaseKey?: string
    writeToTarget?: boolean
}

export type WorkspaceToStandardConversionResult = {
    databaseKey: string
    databaseBin: Uint8Array
    database: Database
    validation: WorkspaceValidationResult
    written: boolean
}

export async function convertWorkspaceToStandardDatabase(
    workspaceRoot: FileSystemDirectoryHandle,
    targetStorage: RisuRawStorage,
    options: WorkspaceToStandardConversionOptions = {}
): Promise<WorkspaceToStandardConversionResult> {
    const databaseKey = options.databaseKey ?? standardDatabaseBinKey
    const workspaceDatabase = await readWorkspaceDatabase(workspaceRoot)
    const databaseBin = await encodeStandardDatabaseBin(workspaceDatabase, {
        encoding: options.encoding,
        compression: options.compression
    })
    const restoredDatabase = await decodeStandardDatabaseBin(databaseBin)
    const validation = assertWorkspaceMigrationValid(workspaceDatabase, restoredDatabase, {
        compareSerializableValues: options.compareSerializableValues
    })
    const writeToTarget = options.writeToTarget ?? true

    if(writeToTarget){
        await targetStorage.setItem(databaseKey, databaseBin)
    }

    return {
        databaseKey,
        databaseBin,
        database: restoredDatabase,
        validation,
        written: writeToTarget
    }
}

export async function previewWorkspaceToStandardDatabase(
    workspaceRoot: FileSystemDirectoryHandle,
    options: Omit<WorkspaceToStandardConversionOptions, "writeToTarget"> = {}
): Promise<Omit<WorkspaceToStandardConversionResult, "written">> {
    const databaseKey = options.databaseKey ?? standardDatabaseBinKey
    const workspaceDatabase = await readWorkspaceDatabase(workspaceRoot)
    const databaseBin = await encodeStandardDatabaseBin(workspaceDatabase, {
        encoding: options.encoding,
        compression: options.compression
    })
    const restoredDatabase = await decodeStandardDatabaseBin(databaseBin)
    const validation = assertWorkspaceMigrationValid(workspaceDatabase, restoredDatabase, {
        compareSerializableValues: options.compareSerializableValues
    })

    return {
        databaseKey,
        databaseBin,
        database: restoredDatabase,
        validation
    }
}
