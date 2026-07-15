import { DBState } from './stores.svelte'

export interface ApiUsageModelStats {
    inputTokens: number
    outputTokens: number
    requestCount: number
    successRequestCount: number
    failedRequestCount: number
    cancelledRequestCount: number
    requestCountsByMode: Record<ApiUsageRequestMode, number>
    estimatedCostUsd: number
    unpricedRequestCount: number
}

export interface ApiUsageDay extends ApiUsageModelStats {
    models: Record<string, ApiUsageModelStats>
}

export interface ApiUsageStats {
    daily: Record<string, ApiUsageDay>
    customPricing: Record<string, ApiUsageCustomPricing>
}

export interface ApiUsageCustomPricing {
    input: number
    output: number
}

export type ApiUsageSummaryRange = 7 | 30 | 90 | 365 | 'all'
export type ApiUsageRequestStatus = 'success' | 'failed' | 'cancelled'
export type ApiUsageRequestMode = 'model' | 'submodel' | 'memory' | 'emotion' | 'otherAx' | 'translate'

export const apiUsageRequestModes: ApiUsageRequestMode[] = [
    'model',
    'submodel',
    'memory',
    'emotion',
    'otherAx',
    'translate',
]

interface PricingRate {
    input: number
    output: number
}

interface PricingRule extends PricingRate {
    matches: (model: string) => boolean
    longContext?: PricingRate & { threshold: number }
}

export interface ApiUsageRecord {
    model: string
    inputTokens: number
    outputTokens: number
    date?: Date
    flexProcessing?: boolean
    status?: ApiUsageRequestStatus
    mode?: ApiUsageRequestMode
    useBuiltInPricing?: boolean
}

// Standard first-party text-token prices in USD per 1M tokens.
// Updated 2026-07-15 from the providers' official pricing documentation.
const pricingRules: PricingRule[] = [
    {
        matches: (model) => model === 'gpt-5.5' || model.startsWith('gpt-5.5-2026-'),
        input: 5,
        output: 30,
        longContext: { threshold: 272_000, input: 10, output: 45 },
    },
    {
        matches: (model) => model === 'gpt-5.4-pro' || model.startsWith('gpt-5.4-pro-2026-'),
        input: 30,
        output: 180,
        longContext: { threshold: 272_000, input: 60, output: 270 },
    },
    {
        matches: (model) => model === 'gpt-5.4' || model.startsWith('gpt-5.4-2026-'),
        input: 2.5,
        output: 15,
        longContext: { threshold: 272_000, input: 5, output: 22.5 },
    },
    {
        matches: (model) => model === 'gpt-5.2' || model.startsWith('gpt-5.2-'),
        input: 1.75,
        output: 14,
    },
    {
        matches: (model) => model === 'gpt-5.1' || model.startsWith('gpt-5.1-'),
        input: 1.25,
        output: 10,
    },
    {
        matches: (model) => model === 'gpt-5-mini' || model.startsWith('gpt-5-mini-'),
        input: 0.25,
        output: 2,
    },
    {
        matches: (model) => model === 'gpt-5-nano' || model.startsWith('gpt-5-nano-'),
        input: 0.05,
        output: 0.4,
    },
    {
        matches: (model) => model === 'gpt-5' || model.startsWith('gpt-5-2025-') || model === 'gpt-5-chat-latest',
        input: 1.25,
        output: 10,
    },
    {
        matches: (model) => model === 'gpt-4.1-mini' || model.startsWith('gpt-4.1-mini-'),
        input: 0.4,
        output: 1.6,
    },
    {
        matches: (model) => model === 'gpt-4.1-nano' || model.startsWith('gpt-4.1-nano-'),
        input: 0.1,
        output: 0.4,
    },
    {
        matches: (model) => model === 'gpt-4.1' || model.startsWith('gpt-4.1-'),
        input: 2,
        output: 8,
    },
    {
        matches: (model) => model === 'gpt-4o-mini' || model.startsWith('gpt-4o-mini-'),
        input: 0.15,
        output: 0.6,
    },
    {
        matches: (model) => model === 'gpt-4o' || model.startsWith('gpt-4o-'),
        input: 2.5,
        output: 10,
    },
    {
        matches: (model) => /^claude-opus-4-(8|7|6|5)(-|$)/.test(model),
        input: 5,
        output: 25,
    },
    {
        matches: (model) => /^claude-sonnet-4-(6|5)(-|$)/.test(model),
        input: 3,
        output: 15,
    },
    {
        matches: (model) => model.startsWith('claude-haiku-4-5'),
        input: 1,
        output: 5,
    },
    {
        matches: (model) => /^claude-3-(7|5)-sonnet/.test(model),
        input: 3,
        output: 15,
    },
    {
        matches: (model) => model.startsWith('claude-3-5-haiku'),
        input: 0.8,
        output: 4,
    },
    {
        matches: (model) => model.startsWith('claude-3-opus'),
        input: 15,
        output: 75,
    },
    {
        matches: (model) => model.startsWith('claude-3-sonnet'),
        input: 3,
        output: 15,
    },
    {
        matches: (model) => model.startsWith('claude-3-haiku'),
        input: 0.25,
        output: 1.25,
    },
    {
        matches: (model) => model === 'gemini-3.1-pro-preview',
        input: 2,
        output: 12,
        longContext: { threshold: 200_000, input: 4, output: 18 },
    },
    {
        matches: (model) => model === 'gemini-3-flash-preview',
        input: 0.5,
        output: 3,
    },
    {
        matches: (model) => model === 'gemini-3-pro-preview',
        input: 2,
        output: 12,
        longContext: { threshold: 200_000, input: 4, output: 18 },
    },
    {
        matches: (model) => model.startsWith('gemini-2.5-pro'),
        input: 1.25,
        output: 10,
        longContext: { threshold: 200_000, input: 2.5, output: 15 },
    },
    {
        matches: (model) => model.startsWith('gemini-2.5-flash-lite'),
        input: 0.1,
        output: 0.4,
    },
    {
        matches: (model) => model.startsWith('gemini-2.5-flash') && !model.includes('image'),
        input: 0.3,
        output: 2.5,
    },
    {
        matches: (model) => model.startsWith('gemini-2.0-flash'),
        input: 0.1,
        output: 0.4,
    },
]

export function createEmptyApiUsageStats(): ApiUsageStats {
    return { daily: {}, customPricing: {} }
}

export function normalizeApiUsageStats(value: unknown): ApiUsageStats {
    if (!value || typeof value !== 'object') {
        return createEmptyApiUsageStats()
    }

    const normalized = createEmptyApiUsageStats()
    const stored = value as Partial<ApiUsageStats>
    const daily = stored.daily
    if (daily && typeof daily === 'object' && !Array.isArray(daily)) {
        for (const [date, storedDay] of Object.entries(daily)) {
            if (!storedDay || typeof storedDay !== 'object' || Array.isArray(storedDay)) {
                continue
            }

            const day = normalizeStoredStats(storedDay)
            const storedModels = (storedDay as Partial<ApiUsageDay>).models
            const models: Record<string, ApiUsageModelStats> = {}
            if (storedModels && typeof storedModels === 'object' && !Array.isArray(storedModels)) {
                for (const [model, stats] of Object.entries(storedModels)) {
                    if (stats && typeof stats === 'object' && !Array.isArray(stats)) {
                        models[model] = normalizeStoredStats(stats)
                    }
                }
            }
            normalized.daily[date] = { ...day, models }
        }
    }

    const customPricing = stored.customPricing
    if (customPricing && typeof customPricing === 'object' && !Array.isArray(customPricing)) {
        for (const [rawModel, rawRate] of Object.entries(customPricing)) {
            const model = rawModel.trim()
            if (!isSafePricingModel(model) || !rawRate || typeof rawRate !== 'object' || Array.isArray(rawRate)) {
                continue
            }
            const rate = rawRate as Partial<ApiUsageCustomPricing>
            if (isValidPrice(rate.input) && isValidPrice(rate.output)) {
                normalized.customPricing[model] = { input: rate.input, output: rate.output }
            }
        }
    }

    return normalized
}

function isValidPrice(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isSafePricingModel(model: string): boolean {
    return model.length > 0 && !['__proto__', 'prototype', 'constructor'].includes(model)
}

export function setApiUsageCustomPricing(model: string, input: number, output: number): boolean {
    const normalizedModel = model.trim()
    if (!isSafePricingModel(normalizedModel) || !isValidPrice(input) || !isValidPrice(output)) {
        return false
    }

    DBState.db.apiUsage.customPricing = {
        ...(DBState.db.apiUsage.customPricing ?? {}),
        [normalizedModel]: { input, output },
    }
    return true
}

export function deleteApiUsageCustomPricing(model: string) {
    DBState.db.apiUsage.customPricing = Object.fromEntries(
        Object.entries(DBState.db.apiUsage.customPricing ?? {}).filter(([storedModel]) => storedModel !== model),
    )
}

export function getApiUsageDateKey(date = new Date()): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function normalizePricingModel(model: string): string | null {
    if (/^(openrouter-|NanoGPT |Ollama |custom-|pluginmodel:::)/i.test(model)) {
        return null
    }

    const normalized = model.replace(/-response-api$/, '').replace(/-vertex$/, '')
    if (normalized === 'gpt41') return 'gpt-4.1'
    if (normalized === 'gpt41-mini') return 'gpt-4.1-mini'
    if (normalized === 'gpt41-nano') return 'gpt-4.1-nano'
    if (normalized === 'gpt4o' || /^gpt4o-2024-/.test(normalized)) {
        return normalized.replace('gpt4o', 'gpt-4o')
    }
    if (normalized === 'gpt4om' || normalized.startsWith('gpt4om-')) {
        return normalized.replace('gpt4om', 'gpt-4o-mini')
    }
    return normalized
}

export function estimateApiUsageCost(
    record: ApiUsageRecord,
    customPricing: Record<string, ApiUsageCustomPricing> = {},
): number | null {
    const model = normalizePricingModel(record.model)
    const customRate = customPricing[record.model] ?? (model ? customPricing[model] : undefined)
    if (customRate) {
        const processingMultiplier = record.flexProcessing && model?.startsWith('gpt-') ? 0.5 : 1
        return (
            (record.inputTokens * customRate.input + record.outputTokens * customRate.output)
            / 1_000_000
            * processingMultiplier
        )
    }

    if (record.useBuiltInPricing === false) return null
    if (!model) return null
    const rule = pricingRules.find((candidate) => candidate.matches(model))
    if (!rule) {
        return null
    }

    const rate = rule.longContext && record.inputTokens > rule.longContext.threshold
        ? rule.longContext
        : rule
    const processingMultiplier = record.flexProcessing && model.startsWith('gpt-') ? 0.5 : 1

    return (
        (record.inputTokens * rate.input + record.outputTokens * rate.output)
        / 1_000_000
        * processingMultiplier
    )
}

function createEmptyModelStats(): ApiUsageModelStats {
    return {
        inputTokens: 0,
        outputTokens: 0,
        requestCount: 0,
        successRequestCount: 0,
        failedRequestCount: 0,
        cancelledRequestCount: 0,
        requestCountsByMode: createEmptyRequestCountsByMode(),
        estimatedCostUsd: 0,
        unpricedRequestCount: 0,
    }
}

function createEmptyRequestCountsByMode(): Record<ApiUsageRequestMode, number> {
    return Object.fromEntries(apiUsageRequestModes.map((mode) => [mode, 0])) as Record<ApiUsageRequestMode, number>
}

export function getApiUsageSummary(
    stats: ApiUsageStats,
    range: ApiUsageSummaryRange,
    today = new Date(),
): ApiUsageModelStats {
    const todayKey = getApiUsageDateKey(today)
    const cutoffKey = range === 'all' ? null : (() => {
        const cutoff = new Date(today)
        cutoff.setDate(cutoff.getDate() - (range - 1))
        return getApiUsageDateKey(cutoff)
    })()

    return Object.entries(stats.daily)
        .filter(([key]) => key <= todayKey && (cutoffKey === null || key >= cutoffKey))
        .reduce((totals, [, day]) => {
            totals.inputTokens += day.inputTokens
            totals.outputTokens += day.outputTokens
            totals.requestCount += day.requestCount
            totals.successRequestCount += day.successRequestCount
            totals.failedRequestCount += day.failedRequestCount
            totals.cancelledRequestCount += day.cancelledRequestCount
            for (const mode of apiUsageRequestModes) {
                totals.requestCountsByMode[mode] += day.requestCountsByMode[mode]
            }
            totals.estimatedCostUsd += day.estimatedCostUsd
            totals.unpricedRequestCount += day.unpricedRequestCount
            return totals
        }, createEmptyModelStats())
}

function normalizeStoredStats(value: object): ApiUsageModelStats {
    const stored = value as Partial<ApiUsageModelStats>
    const numberOrZero = (candidate: unknown) => typeof candidate === 'number' && Number.isFinite(candidate)
        ? Math.max(0, candidate)
        : 0
    const storedRequestCount = numberOrZero(stored.requestCount)
    const failedRequestCount = numberOrZero(stored.failedRequestCount)
    const cancelledRequestCount = numberOrZero(stored.cancelledRequestCount)
    const successRequestCount = typeof stored.successRequestCount === 'number'
        ? numberOrZero(stored.successRequestCount)
        : Math.max(0, storedRequestCount - failedRequestCount - cancelledRequestCount)
    const requestCountsByMode = createEmptyRequestCountsByMode()
    if (stored.requestCountsByMode && typeof stored.requestCountsByMode === 'object') {
        for (const mode of apiUsageRequestModes) {
            requestCountsByMode[mode] = numberOrZero(stored.requestCountsByMode[mode])
        }
    }
    else {
        requestCountsByMode.model = storedRequestCount
    }
    const categorizedRequestCount = successRequestCount + failedRequestCount + cancelledRequestCount
    return {
        inputTokens: numberOrZero(stored.inputTokens),
        outputTokens: numberOrZero(stored.outputTokens),
        requestCount: Math.max(storedRequestCount, categorizedRequestCount),
        successRequestCount,
        failedRequestCount,
        cancelledRequestCount,
        requestCountsByMode,
        estimatedCostUsd: numberOrZero(stored.estimatedCostUsd),
        unpricedRequestCount: numberOrZero(stored.unpricedRequestCount),
    }
}

function addRecord(target: ApiUsageModelStats, record: ApiUsageRecord, estimatedCost: number | null) {
    target.inputTokens += Math.max(0, Math.round(record.inputTokens))
    target.outputTokens += Math.max(0, Math.round(record.outputTokens))
    target.requestCount += 1
    const status = record.status ?? 'success'
    if (status === 'success') target.successRequestCount += 1
    else if (status === 'failed') target.failedRequestCount += 1
    else target.cancelledRequestCount += 1
    target.requestCountsByMode[record.mode ?? 'model'] += 1
    if (estimatedCost === null) {
        target.unpricedRequestCount += 1
    }
    else {
        target.estimatedCostUsd += estimatedCost
    }
}

export function recordApiUsage(record: ApiUsageRecord) {
    if (!DBState.db.apiUsage?.daily || typeof DBState.db.apiUsage.daily !== 'object') {
        DBState.db.apiUsage = createEmptyApiUsageStats()
    }
    DBState.db.apiUsage.customPricing ??= {}

    const dateKey = getApiUsageDateKey(record.date)
    const storedDay = DBState.db.apiUsage.daily[dateKey]
    const day = storedDay ? {
        ...normalizeStoredStats(storedDay),
        models: storedDay.models && typeof storedDay.models === 'object' ? storedDay.models : {},
    } : {
        ...createEmptyModelStats(),
        models: {},
    }
    const rawModel = record.model || 'unknown'
    const model = ['__proto__', 'prototype', 'constructor'].includes(rawModel)
        ? `model:${rawModel}`
        : rawModel
    const modelStats = day.models[model]
        ? normalizeStoredStats(day.models[model])
        : createEmptyModelStats()
    const estimatedCost = estimateApiUsageCost(record, DBState.db.apiUsage.customPricing)

    addRecord(day, record, estimatedCost)
    addRecord(modelStats, record, estimatedCost)
    day.models[model] = modelStats
    DBState.db.apiUsage.daily[dateKey] = day
}
