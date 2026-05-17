import type { Database } from "../database.svelte"
import { decodeRisuSave, encodeRisuSaveLegacy, RisuSaveEncoder } from "../risuSave"

export type StandardDatabaseBinEncoding = "packed" | "block"

export type StandardDatabaseBinCompression = "none" | "compression"

export type EncodeStandardDatabaseBinOptions = {
    encoding?: StandardDatabaseBinEncoding
    compression?: StandardDatabaseBinCompression
}

export async function decodeStandardDatabaseBin(data: Uint8Array | ArrayBuffer): Promise<Database> {
    return await decodeRisuSave(toUint8Array(data))
}

export async function encodeStandardDatabaseBin(
    data: Database,
    options: EncodeStandardDatabaseBinOptions = {}
): Promise<Uint8Array> {
    const {
        encoding = "packed",
        compression = "compression"
    } = options

    if(encoding === "block"){
        const encoder = new RisuSaveEncoder()
        await encoder.init(data, {
            compression: compression === "compression"
        })

        const encoded = encoder.encode()
        if(!encoded){
            throw new Error("Failed to encode standard database bin")
        }

        return toUint8Array(encoded)
    }

    return encodeRisuSaveLegacy(
        data,
        compression === "compression" ? "compression" : "noCompression"
    )
}

export async function validateStandardDatabaseBin(data: Uint8Array | ArrayBuffer): Promise<Database> {
    const decoded = await decodeStandardDatabaseBin(data)
    if(!decoded || typeof decoded !== "object"){
        throw new Error("Decoded standard database bin is not an object")
    }
    return decoded
}

export async function roundTripStandardDatabaseBin(
    data: Database,
    options?: EncodeStandardDatabaseBinOptions
): Promise<Database> {
    const encoded = await encodeStandardDatabaseBin(data, options)
    return await validateStandardDatabaseBin(encoded)
}

function toUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
    if(data instanceof Uint8Array){
        return data
    }

    return new Uint8Array(data)
}
