import { DBState } from './stores.svelte'

export interface ApiUsageModelStats {
    inputTokens: number
    outputTokens: number
    requestCount: number
    estimatedCostUsd: number
    unpricedRequestCount: number
}

export interface ApiUsageDay extends ApiUsageModelStats {
    models: Record<string, ApiUsageModelStats>
}

export interface ApiUsageStats {
    daily: Record<string, ApiUsageDay>
}

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
        matches: (model) => /^claude-opus-4-(8|7|6)(-|$)/.test(model),
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
]

export function createEmptyApiUsageStats(): ApiUsageStats {
    return { daily: {} }
}

export function normalizeApiUsageStats(value: unknown): ApiUsageStats {
    if (!value || typeof value !== 'object') {
        return createEmptyApiUsageStats()
    }

    const daily = (value as Partial<ApiUsageStats>).daily
    if (!daily || typeof daily !== 'object' || Array.isArray(daily)) {
        return createEmptyApiUsageStats()
    }

    return value as ApiUsageStats
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

    return model.replace(/-response-api$/, '').replace(/-vertex$/, '')
}

export function estimateApiUsageCost(record: ApiUsageRecord): number | null {
    const model = normalizePricingModel(record.model)
    if (!model) {
        return null
    }

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
        estimatedCostUsd: 0,
        unpricedRequestCount: 0,
    }
}

function addRecord(target: ApiUsageModelStats, record: ApiUsageRecord, estimatedCost: number | null) {
    target.inputTokens += Math.max(0, Math.round(record.inputTokens))
    target.outputTokens += Math.max(0, Math.round(record.outputTokens))
    target.requestCount += 1
    if (estimatedCost === null) {
        target.unpricedRequestCount += 1
    }
    else {
        target.estimatedCostUsd += estimatedCost
    }
}

export function recordApiUsage(record: ApiUsageRecord) {
    DBState.db.apiUsage = normalizeApiUsageStats(DBState.db.apiUsage)

    const dateKey = getApiUsageDateKey(record.date)
    const day = DBState.db.apiUsage.daily[dateKey] ?? {
        ...createEmptyModelStats(),
        models: {},
    }
    const model = record.model || 'unknown'
    const modelStats = day.models[model] ?? createEmptyModelStats()
    const estimatedCost = estimateApiUsageCost(record)

    addRecord(day, record, estimatedCost)
    addRecord(modelStats, record, estimatedCost)
    day.models[model] = modelStats
    DBState.db.apiUsage.daily[dateKey] = day
}
