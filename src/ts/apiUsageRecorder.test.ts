import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiUsageRecorder } from './apiUsageRecorder'
import { createEmptyApiUsageStats } from './apiUsage'
import type { StreamResponseChunk, requestDataResponse } from './process/request/request'
import { DBState } from './stores.svelte'

vi.mock('./stores.svelte', () => ({
    DBState: { db: {} },
}))

vi.mock('./tokenizer', () => ({
    ChatTokenizer: class {
        async tokenizeChats() {
            return 12
        }
    },
    tokenize: vi.fn(async (text: string) => text.length),
}))

function makeRecorder(options: {
    mode?: 'model' | 'translate' | 'otherAx'
    abortSignal?: AbortSignal
    useBuiltInPricing?: boolean
} = {}) {
    return createApiUsageRecorder({
        formated: [{ role: 'user', content: 'Hello' }],
        mode: options.mode ?? 'model',
        model: 'gpt-5.5',
        modelInfo: { internalID: 'gpt-5.5' } as never,
        abortSignal: options.abortSignal,
        useBuiltInPricing: options.useBuiltInPricing,
    })
}

describe('API usage request recorder', () => {
    beforeEach(() => {
        DBState.db.apiUsage = createEmptyApiUsageStats()
    })

    it('records successful translation requests', async () => {
        const recorder = makeRecorder({ mode: 'translate' })
        await recorder.finalizeResponse({ type: 'success', result: 'Done' })

        const day = Object.values(DBState.db.apiUsage.daily)[0]
        expect(day).toMatchObject({
            inputTokens: 12,
            outputTokens: 4,
            requestCount: 1,
            successRequestCount: 1,
            requestCountsByMode: { translate: 1 },
        })
    })

    it('records provider-internal retries as separate attempts', async () => {
        const recorder = makeRecorder({ mode: 'otherAx' })
        await recorder.recordNextAttempt('failed')
        await recorder.finalizeResponse({ type: 'success', result: 'Done' })

        const day = Object.values(DBState.db.apiUsage.daily)[0]
        expect(day).toMatchObject({
            requestCount: 2,
            successRequestCount: 1,
            failedRequestCount: 1,
            requestCountsByMode: { otherAx: 2 },
        })
    })

    it('records the provider-resolved model ID instead of the routing model', async () => {
        DBState.db.apiUsage.customPricing['google/gemma-4-31b-it'] = { input: 1, output: 2 }
        const recorder = makeRecorder()
        recorder.resolveModel('google/gemma-4-31b-it')
        await recorder.finalizeResponse({ type: 'success', result: 'Done' })

        const day = Object.values(DBState.db.apiUsage.daily)[0]
        expect(day.models).toMatchObject({
            'google/gemma-4-31b-it': {
                requestCount: 1,
                successRequestCount: 1,
            },
        })
        expect(day.models['gpt-5.5']).toBeUndefined()
        expect(day.estimatedCostUsd).toBe(0.00002)
    })

    it('keeps each provider attempt under the model resolved for that attempt', async () => {
        const recorder = makeRecorder()
        recorder.resolveModel('provider/first-model')
        await recorder.recordNextAttempt('failed')
        recorder.resolveModel('provider/fallback-model')
        await recorder.finalizeResponse({ type: 'success', result: 'Done' })

        const day = Object.values(DBState.db.apiUsage.daily)[0]
        expect(day.models['provider/first-model']).toMatchObject({
            requestCount: 1,
            failedRequestCount: 1,
        })
        expect(day.models['provider/fallback-model']).toMatchObject({
            requestCount: 1,
            successRequestCount: 1,
        })
    })

    it('ignores empty provider model IDs and keeps the routing fallback', async () => {
        const recorder = makeRecorder()
        recorder.resolveModel('   ')
        await recorder.finalizeResponse({ type: 'success', result: 'Done' })

        const day = Object.values(DBState.db.apiUsage.daily)[0]
        expect(day.models['gpt-5.5'].requestCount).toBe(1)
    })

    it('keeps intermediary model IDs while leaving them unpriced', async () => {
        const recorder = makeRecorder({ useBuiltInPricing: false })
        recorder.resolveModel('gpt-5.5')
        await recorder.finalizeResponse({ type: 'success', result: 'Done' })

        const day = Object.values(DBState.db.apiUsage.daily)[0]
        expect(day.models['gpt-5.5']).toMatchObject({
            requestCount: 1,
            unpricedRequestCount: 1,
        })
        expect(day.estimatedCostUsd).toBe(0)
    })

    it('does not turn a finalized failed follow-up into a successful attempt', async () => {
        const recorder = makeRecorder()
        await recorder.recordNextAttempt('success')
        await recorder.finalizeAttempt('failed')
        await recorder.finalizeResponse({ type: 'success', result: 'Partial tool output' })

        const day = Object.values(DBState.db.apiUsage.daily)[0]
        expect(day).toMatchObject({
            requestCount: 2,
            successRequestCount: 1,
            failedRequestCount: 1,
        })
    })

    it('records only the final cumulative streaming output', async () => {
        const source = new ReadableStream<StreamResponseChunk>({
            start(controller) {
                controller.enqueue({ '0': 'Hi', __thoughts: 'hidden' })
                controller.enqueue({ '0': 'Hello', __thoughts: 'hidden longer' })
                controller.close()
            },
        })
        const response = await makeRecorder({ mode: 'otherAx' }).finalizeResponse({
            type: 'streaming',
            result: source,
        }) as Extract<requestDataResponse, { type: 'streaming' }>
        const reader = response.result.getReader()
        while (!(await reader.read()).done) {
            // Drain the tracked stream.
        }

        const day = Object.values(DBState.db.apiUsage.daily)[0]
        expect(day).toMatchObject({
            outputTokens: 5,
            successRequestCount: 1,
            requestCountsByMode: { otherAx: 1 },
        })
    })

    it('records partial streaming output when cancelled', async () => {
        const abortController = new AbortController()
        const source = new ReadableStream<StreamResponseChunk>({
            start(controller) {
                controller.enqueue({ '0': 'Partial' })
            },
        })
        const response = await makeRecorder({ abortSignal: abortController.signal }).finalizeResponse({
            type: 'streaming',
            result: source,
        }) as Extract<requestDataResponse, { type: 'streaming' }>
        const reader = response.result.getReader()
        await reader.read()
        abortController.abort()
        await reader.cancel()

        const day = Object.values(DBState.db.apiUsage.daily)[0]
        expect(day).toMatchObject({
            outputTokens: 7,
            requestCount: 1,
            cancelledRequestCount: 1,
        })
    })
})
