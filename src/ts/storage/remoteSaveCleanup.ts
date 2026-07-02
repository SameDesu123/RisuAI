import { remoteSavePayloadSuffix } from "./risuSaveBlocks";

export const remoteSaveCleanupGraceMs = 1000 * 60 * 60 * 24 * 7

export type RemoteSaveCleanupAction = 'ignore'|'keep'|'create-meta'|'delete'

export function getBasenameForRemoteSave(path:string){
    return path.split(/[\\/]/).pop() ?? path
}

export function getRemoteSavePayloadBlockName(path:string){
    const name = getBasenameForRemoteSave(path)
    if(name.endsWith('.meta') || !name.endsWith(remoteSavePayloadSuffix)){
        return null
    }
    const blockName = name.slice(0, -remoteSavePayloadSuffix.length)
    return blockName || null
}

export function getRemoteSaveMetaPath(payloadPath:string){
    return `${payloadPath}.meta`
}

export function encodeRemoteSaveMeta(lastUsed = Date.now()){
    return new TextEncoder().encode(JSON.stringify({ lastUsed }))
}

export function decodeRemoteSaveMeta(data:Uint8Array|string){
    try {
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
        const parsed = JSON.parse(text)
        if(Number.isFinite(parsed?.lastUsed)){
            return {
                lastUsed: parsed.lastUsed as number
            }
        }
    } catch (error) {}
    return null
}

export function isRemoteSavePayloadExpired(lastUsed:number, now = Date.now()){
    return Number.isFinite(lastUsed) && now - lastUsed > remoteSaveCleanupGraceMs
}

export function getRemoteSaveCleanupAction(arg:{
    path:string
    activeBlockNames:Set<string>
    metaLastUsed?:number|null
    metaExists?:boolean
    now?:number
}):RemoteSaveCleanupAction{
    const blockName = getRemoteSavePayloadBlockName(arg.path)
    if(!blockName){
        return 'ignore'
    }
    if(arg.activeBlockNames.has(blockName)){
        return 'keep'
    }
    if(!arg.metaExists || arg.metaLastUsed === null || arg.metaLastUsed === undefined){
        return 'create-meta'
    }
    return isRemoteSavePayloadExpired(arg.metaLastUsed, arg.now) ? 'delete' : 'keep'
}
