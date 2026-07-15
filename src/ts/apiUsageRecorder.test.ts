import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiUsageRecorder } from './apiUsageRecorder'
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
} = {}) {
    return createApiUsageRecorder({
        formated: [{ role: 'user', content: 'Hello' }],
        mode: options.mode ?? 'model',
        model: 'gpt-5.5',
        modelInfo: { internalID: 'gpt-5.5' } as never,
        abortSignal: options.abortSignal,
    })
}

describe('API usage request recorder', () => {
    beforeEach(() => {
        DBState.db.apiUsage = { daily: {} }
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
