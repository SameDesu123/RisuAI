import { describe, expect, it, vi } from 'vitest'
import { estimateApiUsageCost, getApiUsageDateKey } from './apiUsage'

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
})
