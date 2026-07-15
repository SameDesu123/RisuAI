import { describe, expect, it, vi } from 'vitest'
import {
    createEmptyApiUsageStats,
    deleteApiUsageCustomPricing,
    estimateApiUsageCost,
    getApiUsageDateKey,
    getApiUsageSummary,
    normalizeApiUsageStats,
    recordApiUsage,
    setApiUsageCustomPricing,
} from './apiUsage'
import { DBState } from './stores.svelte'

vi.mock('./stores.svelte', () => ({
    DBState: { db: {} },
}))

describe('API usage statistics', () => {
    it('uses local calendar dates for daily buckets', () => {
        expect(getApiUsageDateKey(new Date(2026, 6, 5, 23, 30))).toBe('2026-07-05')
    })

    it('estimates standard text-token pricing for supported models', () => {
        expect(estimateApiUsageCost({
            model: 'gpt-5.5-response-api',
            inputTokens: 100_000,
            outputTokens: 100_000,
        })).toBe(3.5)
    })

    it('applies long-context and flex pricing when relevant', () => {
        expect(estimateApiUsageCost({
            model: 'gpt-5.5',
            inputTokens: 300_000,
            outputTokens: 100_000,
            flexProcessing: true,
        })).toBe(3.75)
    })

    it('keeps requests without reliable first-party pricing unpriced', () => {
        expect(estimateApiUsageCost({
            model: 'openrouter-openai/gpt-5.5',
            inputTokens: 1_000,
            outputTokens: 1_000,
        })).toBeNull()
        expect(estimateApiUsageCost({
            model: 'gemini-2.5-flash-image',
            inputTokens: 1_000,
            outputTokens: 1_000,
        })).toBeNull()
    })

    it('uses exact and normalized custom pricing before built-in pricing', () => {
        expect(estimateApiUsageCost({
            model: 'openrouter-openai/custom-model',
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
        }, {
            'openrouter-openai/custom-model': { input: 2, output: 4 },
        })).toBe(6)
        expect(estimateApiUsageCost({
            model: 'gpt41-response-api',
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
        }, {
            'gpt-4.1': { input: 3, output: 9 },
        })).toBe(12)
    })

    it('resolves legacy model registry IDs to their API pricing names', () => {
        expect(estimateApiUsageCost({
            model: 'gpt41-mini-response-api',
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
        })).toBe(2)
    })

    it('normalizes incomplete stored values before displaying them', () => {
        expect(normalizeApiUsageStats({
            daily: {
                '2026-07-05': {
                    inputTokens: 100,
                    outputTokens: Number.NaN,
                    requestCount: 1,
                },
            },
        }).daily['2026-07-05']).toMatchObject({
            inputTokens: 100,
            outputTokens: 0,
            requestCount: 1,
            successRequestCount: 1,
            failedRequestCount: 0,
            cancelledRequestCount: 0,
            requestCountsByMode: {
                model: 1,
            },
            estimatedCostUsd: 0,
            unpricedRequestCount: 0,
            models: {},
        })
    })

    it('normalizes only valid custom pricing entries', () => {
        expect(normalizeApiUsageStats({
            customPricing: {
                'custom-model': { input: 1.5, output: 3 },
                negative: { input: -1, output: 3 },
                constructor: { input: 1, output: 1 },
            },
        }).customPricing).toEqual({
            'custom-model': { input: 1.5, output: 3 },
        })
    })

    it('stores and removes custom pricing without changing daily usage', () => {
        DBState.db.apiUsage = normalizeApiUsageStats({
            daily: {
                '2026-07-05': { inputTokens: 100, requestCount: 1 },
            },
        })

        expect(setApiUsageCustomPricing(' custom-model ', 2, 5)).toBe(true)
        expect(setApiUsageCustomPricing('__proto__', 1, 1)).toBe(false)
        expect(DBState.db.apiUsage.customPricing['custom-model']).toEqual({ input: 2, output: 5 })
        expect(DBState.db.apiUsage.daily['2026-07-05'].requestCount).toBe(1)

        deleteApiUsageCustomPricing('custom-model')
        expect(DBState.db.apiUsage.customPricing).toEqual({})
    })

    it('summarizes inclusive date ranges and excludes future records', () => {
        const stats = normalizeApiUsageStats({
            daily: {
                '2026-07-08': { inputTokens: 100, requestCount: 1 },
                '2026-07-09': { inputTokens: 200, requestCount: 2 },
                '2026-07-15': { outputTokens: 50, requestCount: 1 },
                '2026-07-16': { inputTokens: 1_000, requestCount: 1 },
            },
        })
        const today = new Date(2026, 6, 15, 12)

        expect(getApiUsageSummary(stats, 7, today)).toMatchObject({
            inputTokens: 200,
            outputTokens: 50,
            requestCount: 3,
        })
        expect(getApiUsageSummary(stats, 'all', today)).toMatchObject({
            inputTokens: 300,
            outputTokens: 50,
            requestCount: 4,
        })
    })

    it('aggregates successful requests by local day and model', () => {
        DBState.db.apiUsage = createEmptyApiUsageStats()
        recordApiUsage({
            model: 'claude-3-5-sonnet-latest',
            inputTokens: 1_000,
            outputTokens: 200,
            date: new Date(2026, 6, 5, 12),
        })

        const day = DBState.db.apiUsage.daily['2026-07-05']
        expect(day).toMatchObject({
            inputTokens: 1_000,
            outputTokens: 200,
            requestCount: 1,
            unpricedRequestCount: 0,
        })
        expect(day.models['claude-3-5-sonnet-latest'].requestCount).toBe(1)
    })

    it('records failed, cancelled, translation, and auxiliary attempts separately', () => {
        DBState.db.apiUsage = createEmptyApiUsageStats()
        recordApiUsage({
            model: 'gpt-5.5',
            inputTokens: 100,
            outputTokens: 0,
            status: 'failed',
            mode: 'translate',
            date: new Date(2026, 6, 5, 12),
        })
        recordApiUsage({
            model: 'gpt-5.5',
            inputTokens: 100,
            outputTokens: 20,
            status: 'cancelled',
            mode: 'otherAx',
            date: new Date(2026, 6, 5, 12),
        })

        expect(DBState.db.apiUsage.daily['2026-07-05']).toMatchObject({
            requestCount: 2,
            successRequestCount: 0,
            failedRequestCount: 1,
            cancelledRequestCount: 1,
            requestCountsByMode: {
                translate: 1,
                otherAx: 1,
            },
        })
    })
})
