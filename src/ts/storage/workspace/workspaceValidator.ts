import type { Database } from "../database.svelte"

export type WorkspaceValidationSeverity = "error" | "warning"

export type WorkspaceValidationIssue = {
    severity: WorkspaceValidationSeverity
    code: string
    message: string
    path?: string
}

export type WorkspaceValidationResult = {
    ok: boolean
    errors: WorkspaceValidationIssue[]
    warnings: WorkspaceValidationIssue[]
    issues: WorkspaceValidationIssue[]
}

export type WorkspaceValidationOptions = {
    compareSerializableValues?: boolean
}

const splitDatabaseKeys = [
    "characters",
    "botPresets",
    "modules",
    "plugins",
    "pluginCustomStorage"
] as const

const rootKeysToCompare = [
    "formatversion",
    "apiType",
    "aiModel",
    "subModel",
    "username",
    "language",
    "theme",
    "selectedPersona",
    "botPresetsId",
    "loreBookPage"
] as const

export function validateWorkspaceDatabaseShape(database: Database, label = "database"): WorkspaceValidationResult {
    const issues: WorkspaceValidationIssue[] = []

    if(!database || typeof database !== "object"){
        issues.push({
            severity: "error",
            code: "database.invalid",
            message: `${label} is not an object`
        })
        return createValidationResult(issues)
    }

    validateArrayField(database, "characters", issues, label, true)
    validateArrayField(database, "botPresets", issues, label)
    validateArrayField(database, "modules", issues, label)
    validateArrayField(database, "plugins", issues, label)
    validateObjectField(database, "pluginCustomStorage", issues, label)

    return createValidationResult(issues)
}

export function validateWorkspaceMigration(
    source: Database,
    restored: Database,
    options: WorkspaceValidationOptions = {}
): WorkspaceValidationResult {
    const issues: WorkspaceValidationIssue[] = []

    issues.push(...validateWorkspaceDatabaseShape(source, "source").issues)
    issues.push(...validateWorkspaceDatabaseShape(restored, "restored").issues)

    if(issues.some((issue) => issue.severity === "error")){
        return createValidationResult(issues)
    }

    compareArrayLength(source, restored, "characters", issues)
    compareArrayLength(source, restored, "botPresets", issues)
    compareArrayLength(source, restored, "modules", issues)
    compareArrayLength(source, restored, "plugins", issues)
    compareObjectKeyCount(source, restored, "pluginCustomStorage", issues)
    compareRootKeys(source, restored, issues)
    compareCharacters(source, restored, issues)

    if(options.compareSerializableValues){
        compareSerializableValue(source, restored, "database", issues)
    }

    return createValidationResult(issues)
}

export function assertWorkspaceMigrationValid(
    source: Database,
    restored: Database,
    options?: WorkspaceValidationOptions
): WorkspaceValidationResult {
    const result = validateWorkspaceMigration(source, restored, options)
    if(!result.ok){
        throw new Error(formatWorkspaceValidationResult(result))
    }
    return result
}

export function formatWorkspaceValidationResult(result: WorkspaceValidationResult) {
    if(result.ok){
        return "Workspace validation passed"
    }

    return result.errors
        .map((issue) => {
            const path = issue.path ? ` at ${issue.path}` : ""
            return `[${issue.code}]${path} ${issue.message}`
        })
        .join("\n")
}

function validateArrayField(
    database: Database,
    key: string,
    issues: WorkspaceValidationIssue[],
    label: string,
    required = false
) {
    const value = (database as any)[key]
    if(value === undefined || value === null){
        issues.push({
            severity: required ? "error" : "warning",
            code: required ? "field.missing" : "field.optionalMissing",
            message: `${label}.${key} is missing`,
            path: `${label}.${key}`
        })
        return
    }

    if(!Array.isArray(value)){
        issues.push({
            severity: "error",
            code: "field.notArray",
            message: `${label}.${key} must be an array`,
            path: `${label}.${key}`
        })
    }
}

function validateObjectField(
    database: Database,
    key: string,
    issues: WorkspaceValidationIssue[],
    label: string
) {
    const value = (database as any)[key]
    if(value === undefined || value === null){
        issues.push({
            severity: "warning",
            code: "field.optionalMissing",
            message: `${label}.${key} is missing`,
            path: `${label}.${key}`
        })
        return
    }

    if(typeof value !== "object" || Array.isArray(value)){
        issues.push({
            severity: "error",
            code: "field.notObject",
            message: `${label}.${key} must be an object`,
            path: `${label}.${key}`
        })
    }
}

function compareArrayLength(
    source: Database,
    restored: Database,
    key: string,
    issues: WorkspaceValidationIssue[]
) {
    const sourceValue = (source as any)[key]
    const restoredValue = (restored as any)[key]

    if(!Array.isArray(sourceValue) || !Array.isArray(restoredValue)){
        return
    }

    if(sourceValue.length !== restoredValue.length){
        issues.push({
            severity: "error",
            code: "array.lengthMismatch",
            message: `Expected ${sourceValue.length} items, restored ${restoredValue.length}`,
            path: key
        })
    }
}

function compareObjectKeyCount(
    source: Database,
    restored: Database,
    key: string,
    issues: WorkspaceValidationIssue[]
) {
    const sourceValue = (source as any)[key]
    const restoredValue = (restored as any)[key]

    if(!isPlainObject(sourceValue) || !isPlainObject(restoredValue)){
        return
    }

    const sourceKeys = Object.keys(sourceValue)
    const restoredKeys = Object.keys(restoredValue)

    if(sourceKeys.length !== restoredKeys.length){
        issues.push({
            severity: "error",
            code: "object.keyCountMismatch",
            message: `Expected ${sourceKeys.length} keys, restored ${restoredKeys.length}`,
            path: key
        })
        return
    }

    for(const sourceKey of sourceKeys){
        if(!Object.prototype.hasOwnProperty.call(restoredValue, sourceKey)){
            issues.push({
                severity: "error",
                code: "object.keyMissing",
                message: `Missing key ${sourceKey}`,
                path: `${key}.${sourceKey}`
            })
        }
    }
}

function compareRootKeys(source: Database, restored: Database, issues: WorkspaceValidationIssue[]) {
    for(const key of rootKeysToCompare){
        const sourceValue = (source as any)[key]
        const restoredValue = (restored as any)[key]

        if(sourceValue === undefined && restoredValue === undefined){
            continue
        }

        if(!areSerializableValuesEqual(sourceValue, restoredValue)){
            issues.push({
                severity: "error",
                code: "root.valueMismatch",
                message: `Expected ${JSON.stringify(sourceValue)}, restored ${JSON.stringify(restoredValue)}`,
                path: key
            })
        }
    }
}

function compareCharacters(source: Database, restored: Database, issues: WorkspaceValidationIssue[]) {
    const sourceCharacters = (source as any).characters
    const restoredCharacters = (restored as any).characters

    if(!Array.isArray(sourceCharacters) || !Array.isArray(restoredCharacters)){
        return
    }

    const length = Math.min(sourceCharacters.length, restoredCharacters.length)
    for(let i = 0; i < length; i++){
        const sourceCharacter = sourceCharacters[i]
        const restoredCharacter = restoredCharacters[i]
        const sourceId = getCharacterId(sourceCharacter)
        const restoredId = getCharacterId(restoredCharacter)

        if(sourceId !== restoredId){
            issues.push({
                severity: "error",
                code: "character.idMismatch",
                message: `Expected character id ${sourceId}, restored ${restoredId}`,
                path: `characters.${i}`
            })
        }

        const sourceChatCount = getChatCount(sourceCharacter)
        const restoredChatCount = getChatCount(restoredCharacter)
        if(sourceChatCount !== restoredChatCount){
            issues.push({
                severity: "error",
                code: "character.chatCountMismatch",
                message: `Expected ${sourceChatCount} chats, restored ${restoredChatCount}`,
                path: `characters.${i}.chats`
            })
        }

        const sourceName = getCharacterName(sourceCharacter)
        const restoredName = getCharacterName(restoredCharacter)
        if(sourceName !== restoredName){
            issues.push({
                severity: "warning",
                code: "character.nameMismatch",
                message: `Expected character name ${sourceName}, restored ${restoredName}`,
                path: `characters.${i}.name`
            })
        }
    }
}

function compareSerializableValue(
    source: unknown,
    restored: unknown,
    path: string,
    issues: WorkspaceValidationIssue[]
) {
    const normalizedSource = normalizeForSerializableCompare(source)
    const normalizedRestored = normalizeForSerializableCompare(restored)

    if(!areSerializableValuesEqual(normalizedSource, normalizedRestored)){
        issues.push({
            severity: "error",
            code: "value.serializableMismatch",
            message: "Serializable database value differs after workspace round trip",
            path
        })
    }
}

function createValidationResult(issues: WorkspaceValidationIssue[]): WorkspaceValidationResult {
    const errors = issues.filter((issue) => issue.severity === "error")
    const warnings = issues.filter((issue) => issue.severity === "warning")

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        issues
    }
}

function getCharacterId(character: any) {
    if(typeof character?.chaId === "string"){
        return character.chaId
    }
    if(typeof character?.id === "string"){
        return character.id
    }
    return undefined
}

function getCharacterName(character: any) {
    if(typeof character?.name === "string"){
        return character.name
    }
    if(typeof character?.nickname === "string"){
        return character.nickname
    }
    return undefined
}

function getChatCount(character: any) {
    if(Array.isArray(character?.chats)){
        return character.chats.length
    }
    return 0
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function areSerializableValuesEqual(a: unknown, b: unknown) {
    return JSON.stringify(normalizeForSerializableCompare(a)) === JSON.stringify(normalizeForSerializableCompare(b))
}

function normalizeForSerializableCompare(value: unknown): unknown {
    if(value === undefined){
        return undefined
    }

    if(Array.isArray(value)){
        return value.map((item) => item === undefined ? null : normalizeForSerializableCompare(item))
    }

    if(isPlainObject(value)){
        const result: Record<string, unknown> = {}
        for(const key of Object.keys(value).sort()){
            const normalized = normalizeForSerializableCompare(value[key])
            if(normalized !== undefined){
                result[key] = normalized
            }
        }
        return result
    }

    return value
}

export function getWorkspaceSplitDatabaseKeys() {
    return [...splitDatabaseKeys]
}
