import type { Database } from "../database.svelte"
import type { toSaveType } from "../risuSave"

export type SaveSectionChangeKind = "added" | "updated" | "removed" | "reordered"

export type SaveSectionChange = {
    scope: string
    section: string
    kind: SaveSectionChangeKind
    fields: string[]
    ownerId?: string
    resourceId?: string
}

export type SaveSectionDiagnosticReason = "dirty" | "forced-full-reload"

export type SaveSectionDiagnosticReport = {
    reason: SaveSectionDiagnosticReason
    legacyTargets: toSaveType
    changes: SaveSectionChange[]
}

type SectionDefinition = Record<string, readonly string[]>

type SectionRecord = {
    scope: string
    section: string
    fields: Record<string, string>
    ownerId?: string
    resourceId?: string
}

type OrderRecord = {
    scope: string
    section: string
    ids: string[]
    ownerId?: string
}

type SaveSectionSnapshot = {
    records: Map<string, SectionRecord>
    orders: Map<string, OrderRecord>
}

export type PreparedSaveSectionDiagnostics = {
    report: SaveSectionDiagnosticReport
    snapshot: SaveSectionSnapshot
}

const rootSections: SectionDefinition = {
    user: ["username", "userIcon", "userNote", "selectedPersona", "personas", "globalChatVariables"],
    ui: [
        "language", "theme", "translator", "zoomsize", "customBackground", "fullScreen", "playMessage",
        "iconsize", "waifuWidth", "waifuWidth2", "promptTextInfoInsideChat", "showFirstMessagePages",
        "settingsCloseButtonSize", "enableBookmark", "hideAllImages", "autoScrollToNewMessage",
        "alwaysScrollToNewMessage", "newMessageButtonStyle", "createFolderOnBranch", "hamburgerButtonBottom",
        "blockquoteStyling", "longPressToPopupEditor",
    ],
    provider: [
        "apiType", "openAIKey", "proxyKey", "aiModel", "subModel", "currentPluginProvider",
        "textgenWebUIStreamURL", "textgenWebUIBlockingURL", "forceReplaceUrl", "requestLocation",
        "localNetworkMode", "localNetworkTimeoutSec", "hubServerType", "ImagenModel", "ImagenImageSize",
        "ImagenAspectRatio", "ImagenPersonGeneration", "openaiCompatImage", "wavespeedImage", "dynamicModelRegistry",
    ],
    prompt: [
        "mainPrompt", "jailbreak", "globalNote", "temperature", "askRemoval", "maxContext", "maxResponse",
        "frequencyPenalty", "PresensePenalty", "formatingOrder", "jailbreakToggle", "additionalPrompt",
        "descriptionPrefix", "emotionPrompt", "promptPreprocess", "bias", "verbosity", "dynamicOutput",
    ],
    memory: [
        "loreBookDepth", "loreBookToken", "loreBook", "loreBookPage", "supaMemoryPrompt", "claudeBatching",
        "claude1HourCaching", "rememberToolUsage", "simplifiedToolUse", "streamGeminiThoughts",
        "seperateParametersByModel", "disableSeperateParameterChangeOnPresetChange",
    ],
    storage: [
        "cipherChat", "formatversion", "swipe", "enableScrollToActiveChar", "promptDiffPrefs", "pluginDevelopMode",
        "echoMessage", "echoDelay", "enableRemoteSaving", "enableRisuaiProTools", "epEnabled", "saveSignatures",
        "keepSessionAlive", "customSidebarItems", "lastLoadedLoadoutName", "coldstorage",
        "skipSavingAssetsOnWebSync", "moveInsteadOfCopyOnCMPConvert", "chatLoadInitialPages", "chatLoadAdditionalPages",
    ],
}

const characterSections: SectionDefinition = {
    profile: [
        "name", "nickname", "desc", "personality", "scenario", "notes", "tags", "creator",
        "characterVersion", "creatorNotes", "additionalText", "additionalData", "license",
    ],
    prompt: ["systemPrompt", "postHistoryInstructions", "exampleMessage", "replaceGlobalNote", "defaultVariables"],
    greeting: ["firstMessage", "alternateGreetings", "firstMsgIndex", "group_only_greetings"],
    chatConfig: [
        "chatFolders", "chatPage", "viewScreen", "characters", "characterTalks", "characterActive", "autoMode",
        "useCharacterLore", "bias", "newGenData", "suggestMessages", "orderByOrder", "oneAtTime",
    ],
    assets: [
        "image", "emotionImages", "sdData", "additionalAssets", "ccAssets", "largePortrait", "inlayViewScreen",
        "prebuiltAssetCommand", "prebuiltAssetStyle", "prebuiltAssetExclude",
    ],
    tts: [
        "ttsMode", "ttsSpeech", "voicevoxConfig", "naittsConfig", "gptSoVitsConfig", "fishSpeechConfig",
        "ttsReadOnlyQuoted", "oaiVoice", "oaiTTSConfig", "hfTTS", "vits",
    ],
    scripts: ["backgroundHTML", "backgroundCSS", "virtualscript", "scriptstate"],
    advanced: [
        "utilityBot", "supaMemory", "reloadKeys", "extentions", "removedQuotes",
        "loreSettings", "loreExt", "realmId", "imported", "trashTime", "private", "source", "creation_date",
        "modification_date", "lowLevelAccess", "hideChatIcon", "lastInteraction", "translatorNote",
        "doNotChangeSeperateModels", "escapeOutput", "modules", "coldstorage", "coldStoragedChats", "depth_prompt",
        "lorePlus",
    ],
}

const chatSections: SectionDefinition = {
    messages: ["message"],
    variables: ["scriptstate"],
    lore: ["localLore"],
    memory: ["supaMemoryData", "hypaV2Data", "hypaV3Data", "lastMemory", "suggestMessages"],
    meta: [
        "note", "name", "sdData", "isStreaming", "modules", "bindedPersona", "fmIndex", "folderId", "lastDate",
        "bookmarks", "bookmarkNames",
    ],
}

const presetSections: SectionDefinition = {
    info: ["name", "image"],
    prompt: [
        "mainPrompt", "jailbreak", "globalNote", "formatingOrder", "promptPreprocess", "promptTemplate",
        "promptSettings", "useInstructPrompt", "customPromptTemplateToggle", "templateDefaultVariables",
        "instructChatTemplate", "JinjaTemplate", "groupTemplate", "groupOtherBotRole", "systemContentReplacement",
        "systemRoleReplacement",
    ],
    model: [
        "apiType", "aiModel", "subModel", "currentPluginProvider", "temperature", "maxContext", "maxResponse",
        "frequencyPenalty", "PresensePenalty", "top_p", "repetition_penalty", "min_p", "top_a", "top_k",
        "reasonEffort", "thinkingTokens", "thinkingType", "deepseekThinkingType", "adaptiveThinkingEffort",
        "deepseekReasoningEffort", "verbosity", "dynamicOutput", "modelTools", "fallbackModels",
        "fallbackWhenBlankResponse",
    ],
    provider: [
        "openAIKey", "localNetworkMode", "localNetworkTimeoutSec", "textgenWebUIStreamURL",
        "textgenWebUIBlockingURL", "forceReplaceUrl", "forceReplaceUrl2", "proxyRequestModel",
        "openrouterRequestModel", "proxyKey", "ooba", "ainconfig", "koboldURL", "NAISettings",
        "customProxyRequestModel", "reverseProxyOobaArgs", "openrouterProvider", "customAPIFormat",
        "enableCustomFlags", "customFlags", "seperateParametersEnabled", "seperateParameters",
        "seperateModelsForAxModels", "seperateModels",
    ],
    schema: ["jsonSchemaEnabled", "jsonSchema", "strictJsonSchema", "extractJson"],
    extras: [
        "bias", "autoSuggestPrompt", "autoSuggestPrefix", "autoSuggestClean", "NAIadventure", "NAIappendName",
        "localStopStrings", "moduleIntergration", "outputImageModal", "regex",
    ],
}

const moduleSections: SectionDefinition = {
    info: ["name", "description", "id", "lowLevelAccess", "hideIcon", "namespace", "mcp"],
    lorebook: ["lorebook"],
    regex: ["regex"],
    trigger: ["trigger"],
    assets: ["assets"],
    script: ["cjs", "customModuleToggle", "backgroundEmbedding"],
}

const pluginSections: SectionDefinition = {
    info: ["name", "displayName", "version", "versionOfPlugin", "updateURL", "enabled"],
    arguments: ["arguments", "realArg", "argMeta"],
    links: ["customLink"],
    code: ["script", "allowedIPC"],
}

const loadoutSections: SectionDefinition = {
    info: ["name", "id", "lastUsed", "favorite"],
    scope: ["characterIds", "modules", "presetName", "personaId"],
    state: ["globalVariables"],
}

const rootCollections = new Set(["characters", "botPresets", "modules", "plugins", "pluginCustomStorage", "loadouts"])
const characterCollections = new Set(["chats", "regex", "trigger", "lorebook"])

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

class FingerprintHasher {
    private first = 0x811c9dc5
    private second = 0x9e3779b9

    update(text: string) {
        for (let index = 0; index < text.length; index += 1) {
            const code = text.charCodeAt(index)
            this.first = Math.imul(this.first ^ code, 0x01000193)
            this.second = Math.imul(this.second ^ code, 0x5bd1e995)
        }
        this.first = Math.imul(this.first ^ text.length, 0x01000193)
        this.second = Math.imul(this.second ^ text.length, 0x5bd1e995)
    }

    digest(): string {
        return `${(this.first >>> 0).toString(16).padStart(8, "0")}${(this.second >>> 0).toString(16).padStart(8, "0")}`
    }
}

function updateFingerprint(hasher: FingerprintHasher, value: unknown, ancestors: Set<object>) {
    if (value === null) {
        hasher.update("null")
        return
    }

    const valueType = typeof value
    if (valueType !== "object") {
        hasher.update(valueType)
        hasher.update(String(value))
        return
    }

    const object = value as object
    if (ancestors.has(object)) {
        hasher.update("circular")
        return
    }
    ancestors.add(object)

    if (Array.isArray(value)) {
        hasher.update("array")
        hasher.update(String(value.length))
        value.forEach((item) => updateFingerprint(hasher, item, ancestors))
    }
    else if (value instanceof Uint8Array) {
        hasher.update("uint8")
        hasher.update(String(value.length))
        for (const byte of value) hasher.update(String.fromCharCode(byte))
    }
    else {
        hasher.update("object")
        const source = value as Record<string, unknown>
        const keys = Object.keys(source).sort()
        hasher.update(String(keys.length))
        for (const key of keys) {
            hasher.update(key)
            updateFingerprint(hasher, source[key], ancestors)
        }
    }

    ancestors.delete(object)
}

function fingerprint(value: unknown): string {
    const hasher = new FingerprintHasher()
    updateFingerprint(hasher, value, new Set())
    return hasher.digest()
}

function recordKey(record: Omit<SectionRecord, "fields">): string {
    return [record.scope, record.section, record.ownerId ?? "", record.resourceId ?? ""].join("\0")
}

function orderKey(record: Omit<OrderRecord, "ids">): string {
    return [record.scope, record.section, record.ownerId ?? ""].join("\0")
}

function getResourceId(
    value: unknown,
    index: number,
    prefix: string,
    identityKeys: readonly string[] = ["chaId", "id", "chatId"],
): string {
    if (isRecord(value)) {
        for (const key of identityKeys) {
            if (typeof value[key] === "string" && value[key].length > 0) return value[key]
        }
    }
    return `${prefix}@${index}`
}

function addSectionRecord(
    snapshot: SaveSectionSnapshot,
    source: Record<string, unknown>,
    scope: string,
    section: string,
    keys: readonly string[],
    ownerId?: string,
    resourceId?: string,
) {
    const fields: Record<string, string> = {}
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) fields[key] = fingerprint(source[key])
    }
    if (Object.keys(fields).length === 0) return

    const record = { scope, section, ownerId, resourceId, fields }
    snapshot.records.set(recordKey(record), record)
}

function addObject(
    snapshot: SaveSectionSnapshot,
    value: unknown,
    scope: string,
    definitions: SectionDefinition,
    ignoredKeys: ReadonlySet<string> = new Set(),
    ownerId?: string,
    resourceId?: string,
) {
    if (!isRecord(value)) return

    const known = new Set<string>()
    for (const [section, keys] of Object.entries(definitions)) {
        keys.forEach((key) => known.add(key))
        addSectionRecord(snapshot, value, scope, section, keys, ownerId, resourceId)
    }

    const unknownKeys = Object.keys(value).filter((key) => !known.has(key) && !ignoredKeys.has(key)).sort()
    addSectionRecord(snapshot, value, scope, "unknown", unknownKeys, ownerId, resourceId)
}

function addCollection(
    snapshot: SaveSectionSnapshot,
    values: unknown,
    scope: string,
    definitions: SectionDefinition,
    prefix: string,
    ownerId?: string,
    identityKeys?: readonly string[],
    ignoredKeys: ReadonlySet<string> = new Set(),
) {
    const list = Array.isArray(values) ? values : []
    const identityCounts = new Map<string, number>()
    const ids = list.map((value, index) => {
        const identity = getResourceId(value, index, prefix, identityKeys)
        const count = identityCounts.get(identity) ?? 0
        identityCounts.set(identity, count + 1)
        return count === 0 ? identity : `${identity}#${count + 1}`
    })
    const order = { scope, section: "order", ownerId, ids }
    snapshot.orders.set(orderKey(order), order)

    list.forEach((value, index) => {
        addObject(snapshot, value, scope, definitions, ignoredKeys, ownerId, ids[index])
    })
}

function addOpaqueCollection(
    snapshot: SaveSectionSnapshot,
    values: unknown,
    scope: string,
    prefix: string,
    ownerId?: string,
) {
    const list = Array.isArray(values) ? values : []
    const ids = list.map((value, index) => getResourceId(value, index, prefix))
    const order = { scope, section: "order", ownerId, ids }
    snapshot.orders.set(orderKey(order), order)

    list.forEach((value, index) => {
        const source = isRecord(value) ? value : { value }
        addSectionRecord(snapshot, source, scope, "entry", Object.keys(source).sort(), ownerId, ids[index])
    })
}

function addPluginStorage(snapshot: SaveSectionSnapshot, value: unknown) {
    if (!isRecord(value)) return
    const ids = Object.keys(value).sort()
    const order = { scope: "pluginStorage", section: "order", ids }
    snapshot.orders.set(orderKey(order), order)

    for (const id of ids) {
        const storage = value[id]
        const source = isRecord(storage) ? storage : { value: storage }
        addSectionRecord(snapshot, source, "pluginStorage", "data", Object.keys(source).sort(), undefined, id)
    }
}

function createSnapshot(data: Database): SaveSectionSnapshot {
    const snapshot: SaveSectionSnapshot = { records: new Map(), orders: new Map() }
    const root = data as unknown as Record<string, unknown>
    addObject(snapshot, root, "root", rootSections, rootCollections)
    addCollection(snapshot, root.botPresets, "preset", presetSections, "preset", undefined, ["name"])
    addCollection(snapshot, root.modules, "module", moduleSections, "module")
    addCollection(snapshot, root.plugins, "plugin", pluginSections, "plugin", undefined, ["name"])
    addCollection(snapshot, root.loadouts, "loadout", loadoutSections, "loadout")
    addPluginStorage(snapshot, root.pluginCustomStorage)

    const characters = Array.isArray(root.characters) ? root.characters : []
    const characterIds = characters.map((value, index) => getResourceId(value, index, "character"))
    const characterOrder = { scope: "character", section: "order", ids: characterIds }
    snapshot.orders.set(orderKey(characterOrder), characterOrder)

    characters.forEach((value, index) => {
        const characterId = characterIds[index]
        addObject(snapshot, value, "character", characterSections, characterCollections, undefined, characterId)
        if (!isRecord(value)) return
        addCollection(snapshot, value.chats, "chat", chatSections, "chat", characterId)
        addOpaqueCollection(snapshot, value.regex, "character.regex", "regex", characterId)
        addOpaqueCollection(snapshot, value.trigger, "character.trigger", "trigger", characterId)
        addOpaqueCollection(snapshot, value.lorebook, "character.lorebook", "lore", characterId)
    })

    return snapshot
}

function sameMembers(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false
    const counts = new Map<string, number>()
    left.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
    for (const value of right) {
        const count = counts.get(value)
        if (!count) return false
        if (count === 1) counts.delete(value)
        else counts.set(value, count - 1)
    }
    return counts.size === 0
}

function diffSnapshots(previous: SaveSectionSnapshot, next: SaveSectionSnapshot): SaveSectionChange[] {
    const changes: SaveSectionChange[] = []
    const recordKeys = new Set([...previous.records.keys(), ...next.records.keys()])

    for (const key of recordKeys) {
        const before = previous.records.get(key)
        const after = next.records.get(key)
        const record = after ?? before
        if (!record) continue

        if (!before || !after) {
            changes.push({
                scope: record.scope,
                section: record.section,
                kind: before ? "removed" : "added",
                fields: Object.keys(record.fields).sort(),
                ownerId: record.ownerId,
                resourceId: record.resourceId,
            })
            continue
        }

        const fields = new Set([...Object.keys(before.fields), ...Object.keys(after.fields)])
        const changedFields = [...fields].filter((field) => before.fields[field] !== after.fields[field]).sort()
        if (changedFields.length > 0) {
            changes.push({
                scope: after.scope,
                section: after.section,
                kind: "updated",
                fields: changedFields,
                ownerId: after.ownerId,
                resourceId: after.resourceId,
            })
        }
    }

    for (const [key, after] of next.orders) {
        const before = previous.orders.get(key)
        if (before && sameMembers(before.ids, after.ids) && fingerprint(before.ids) !== fingerprint(after.ids)) {
            changes.push({
                scope: after.scope,
                section: after.section,
                kind: "reordered",
                fields: [],
                ownerId: after.ownerId,
            })
        }
    }

    return changes.sort((left, right) => {
        return [left.scope, left.ownerId ?? "", left.resourceId ?? "", left.section, left.kind].join("\0")
            .localeCompare([right.scope, right.ownerId ?? "", right.resourceId ?? "", right.section, right.kind].join("\0"))
    })
}

export class SaveSectionTracker {
    private baseline: SaveSectionSnapshot

    constructor(data: Database) {
        this.baseline = createSnapshot(data)
    }

    prepare(
        data: Database,
        context: { reason: SaveSectionDiagnosticReason; legacyTargets: toSaveType },
    ): PreparedSaveSectionDiagnostics {
        const snapshot = createSnapshot(data)
        return {
            report: {
                reason: context.reason,
                legacyTargets: {
                    ...context.legacyTargets,
                    character: [...context.legacyTargets.character],
                    chat: context.legacyTargets.chat.map(([characterId, chatId]) => [characterId, chatId]),
                },
                changes: diffSnapshots(this.baseline, snapshot),
            },
            snapshot,
        }
    }

    commit(prepared: PreparedSaveSectionDiagnostics) {
        this.baseline = prepared.snapshot
    }
}
