import type { toSaveType } from "../risuSave"

export type SectionSaveChangeTracker = toSaveType & {
    root?: boolean
    chatMessage?: [string, string][]
    chatVariables?: [string, string][]
    chatLore?: [string, string][]
    chatMemory?: [string, string][]
    chatMeta?: [string, string][]
    moduleInfo?: string[]
    moduleLorebook?: string[]
    moduleRegex?: string[]
    moduleTrigger?: string[]
    moduleAssets?: string[]
    moduleScript?: string[]
    pluginInfo?: string[]
    pluginArguments?: string[]
    pluginLinks?: string[]
    pluginCode?: string[]
    pluginStorage?: string[]
    regex?: [string, string][]
    regexIndex?: string[]
    trigger?: [string, string][]
    triggerIndex?: string[]
    lorebook?: [string, string][]
    lorebookIndex?: string[]
    asset?: string[]
    tts?: string[]
    scriptBackground?: string[]
    scriptVirtual?: string[]
    advanced?: string[]
}

export const saveSectionAssetKeys = [
    "image",
    "emotionImages",
    "sdData",
    "additionalAssets",
    "ccAssets",
    "largePortrait",
    "inlayViewScreen",
    "prebuiltAssetCommand",
    "prebuiltAssetStyle",
    "prebuiltAssetExclude",
] as const

export const saveSectionTtsKeys = [
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
    "vits",
] as const

export const saveSectionBackgroundKeys = [
    "backgroundHTML",
    "backgroundCSS",
] as const

export const saveSectionVirtualScriptKeys = [
    "virtualscript",
    "scriptstate",
] as const

export const saveSectionAdvancedKeys = [
    "utilityBot",
    "supaMemory",
    "replaceGlobalNote",
    "reloadKeys",
    "extentions",
    "license",
    "additionalText",
    "removedQuotes",
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
    "lorePlus",
] as const

export const saveSectionChatMessageKeys = [
    "message",
] as const

export const saveSectionChatVariableKeys = [
    "scriptstate",
] as const

export const saveSectionChatLoreKeys = [
    "localLore",
] as const

export const saveSectionChatMemoryKeys = [
    "supaMemoryData",
    "hypaV2Data",
    "hypaV3Data",
    "lastMemory",
    "suggestMessages",
] as const

export const saveSectionChatMetaKeys = [
    "note",
    "name",
    "sdData",
    "isStreaming",
    "modules",
    "bindedPersona",
    "fmIndex",
    "folderId",
    "lastDate",
    "bookmarks",
    "bookmarkNames",
] as const

export const saveSectionModuleInfoKeys = [
    "name",
    "description",
    "id",
    "lowLevelAccess",
    "hideIcon",
    "namespace",
    "mcp",
] as const

export const saveSectionModuleLorebookKeys = [
    "lorebook",
] as const

export const saveSectionModuleRegexKeys = [
    "regex",
] as const

export const saveSectionModuleTriggerKeys = [
    "trigger",
] as const

export const saveSectionModuleAssetKeys = [
    "assets",
] as const

export const saveSectionModuleScriptKeys = [
    "cjs",
    "customModuleToggle",
    "backgroundEmbedding",
] as const

export const saveSectionPluginInfoKeys = [
    "name",
    "displayName",
    "version",
    "versionOfPlugin",
    "updateURL",
    "enabled",
] as const

export const saveSectionPluginArgumentKeys = [
    "arguments",
    "realArg",
    "argMeta",
] as const

export const saveSectionPluginLinkKeys = [
    "customLink",
] as const

export const saveSectionPluginCodeKeys = [
    "script",
    "allowedIPC",
] as const

export function pushSaveSectionChange(values: string[], value: string) {
    if(value && values[0] !== value){
        values.unshift(value)
    }
}

export function pushSaveSectionPairChange(values: [string, string][], pair: [string, string]) {
    if(
        pair[0] &&
        pair[1] &&
        (
            values[0]?.[0] !== pair[0] ||
            values[0]?.[1] !== pair[1]
        )
    ){
        values.unshift(pair)
    }
}

export function getSaveSectionTrackedResourceId(value: any, index: number, fallbackPrefix: string) {
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

export function createSaveSectionResourceSignatureMap(values: any[], fallbackPrefix: string) {
    const next = new Map<string, string>()
    for(let i = 0; i < values.length; i++){
        const value = values[i]
        const id = getSaveSectionTrackedResourceId(value, i, fallbackPrefix)
        next.set(id, JSON.stringify(value))
    }
    return next
}

export function collectSaveSectionResourceListChanges(arg: {
    characterId: string
    values: any[]
    fallbackPrefix: string
    previous?: Map<string, string>
    changedItems: [string, string][]
    changedIndexes: string[]
}) {
    const next = createSaveSectionResourceSignatureMap(arg.values, arg.fallbackPrefix)
    if(!arg.previous){
        return {
            next,
            changed: false
        }
    }

    let indexChanged = arg.previous.size !== next.size

    for(const [id, signature] of next){
        if(arg.previous.get(id) !== signature){
            pushSaveSectionPairChange(arg.changedItems, [arg.characterId, id])
            indexChanged = true
        }
    }

    for(const id of arg.previous.keys()){
        if(!next.has(id)){
            indexChanged = true
        }
    }

    if(indexChanged){
        pushSaveSectionChange(arg.changedIndexes, arg.characterId)
    }

    return {
        next,
        changed: indexChanged
    }
}
