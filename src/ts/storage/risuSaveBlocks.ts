import type { Database } from "./database.svelte";

export const remoteSavePayloadSuffix = '.local.bin';

export function hashBlockName(input:string){
    let hash = 0xcbf29ce484222325n
    const prime = 0x100000001b3n
    for(let i = 0; i < input.length; i++){
        hash ^= BigInt(input.charCodeAt(i))
        hash = BigInt.asUintN(64, hash * prime)
    }
    return hash.toString(16).padStart(16, '0')
}

export function getChatBlockName(chaId:string, chatId:string){
    return `chat_${hashBlockName(`${chaId}\0${chatId}`)}`
}

export function getRemoteSaveBlockNames(db:Pick<Database, 'characters'>){
    const names = new Set<string>()
    for(const character of db.characters ?? []){
        if(!character?.chaId){
            continue
        }
        names.add(character.chaId)
        for(const chat of character.chats ?? []){
            if(chat?.id){
                names.add(getChatBlockName(character.chaId, chat.id))
            }
        }
    }
    return names
}
