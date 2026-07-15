import { describe, expect, it, vi } from 'vitest'
import { estimateApiUsageCost, getApiUsageDateKey, normalizeApiUsageStats, recordApiUsage } from './apiUsage'
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
            estimatedCostUsd: 0,
            unpricedRequestCount: 0,
            models: {},
        })
    })

    it('aggregates successful requests by local day and model', () => {
        DBState.db.apiUsage = { daily: {} }
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
})
