import type { LLMModel } from './model/modellist'
import type { OpenAIChat } from './process/index.svelte'
import type { requestDataResponse, StreamResponseChunk } from './process/request/request'
import {
    recordApiUsage,
    type ApiUsageRequestMode,
    type ApiUsageRequestStatus,
} from './apiUsage'
import { ChatTokenizer, tokenize, type TokenizerEncodeOptions } from './tokenizer'

interface ApiUsageRecorderOptions {
    formated: OpenAIChat[]
    mode: ApiUsageRequestMode
    model: string
    modelInfo: LLMModel
    abortSignal?: AbortSignal | null
    flexProcessing?: boolean
    useBuiltInPricing?: boolean
}

function getTokenizerOptions(model: string, modelInfo: LLMModel): TokenizerEncodeOptions {
    return {
        aiModel: model,
        modelInfo,
        localOnly: true,
    }
}

async function countOutputTokens(
    output: string[],
    tokenizerOptions: TokenizerEncodeOptions,
): Promise<number> {
    try {
        let tokens = 0
        for (const text of output) {
            tokens += await tokenize(text, tokenizerOptions)
        }
        return tokens
    }
    catch (error) {
        console.error('[API Usage] Failed to count output tokens', error)
        return 0
    }
}

function getStreamOutput(chunk: StreamResponseChunk): string[] {
    return Object.entries(chunk)
        .filter(([key, text]) => !key.startsWith('__') && Boolean(text))
        .map(([, text]) => text)
}

export function createApiUsageRecorder(options: ApiUsageRecorderOptions) {
    const tokenizerOptions = getTokenizerOptions(options.model, options.modelInfo)
    const chatAdditionalTokens = options.model.startsWith('gpt') ? 5 : 3
    const useName = options.model.startsWith('gpt') ? 'noName' : 'name'
    const tokenizer = new ChatTokenizer(chatAdditionalTokens, useName, tokenizerOptions)
    const inputTokensPromise = tokenizer.tokenizeChats(options.formated).catch((error) => {
        console.error('[API Usage] Failed to count input tokens', error)
        return 0
    })
    let resolvedModel = options.modelInfo.internalID || options.model
    let finalized = false

    async function recordAttempt(status: ApiUsageRequestStatus, output: string[] = []) {
        const attemptModel = resolvedModel
        const [inputTokens, outputTokens] = await Promise.all([
            inputTokensPromise,
            countOutputTokens(output, tokenizerOptions),
        ])
        recordApiUsage({
            model: attemptModel,
            inputTokens,
            outputTokens,
            flexProcessing: options.flexProcessing,
            status,
            mode: options.mode,
            useBuiltInPricing: options.useBuiltInPricing,
        })
    }

    async function finalize(status: ApiUsageRequestStatus, output: string[] = []) {
        if (finalized) return
        finalized = true
        await recordAttempt(status, output)
    }

    return {
        resolveModel(model: string | null | undefined) {
            const normalizedModel = model?.trim()
            if (normalizedModel) resolvedModel = normalizedModel
        },
        async finalizeResponse(response: requestDataResponse): Promise<requestDataResponse> {
            if (response.type === 'success') {
                await finalize('success', [response.result])
                return response
            }
            if (response.type === 'multiline') {
                await finalize('success', response.result.map(([, text]) => text))
                return response
            }
            if (response.type === 'fail') {
                await finalize(options.abortSignal?.aborted ? 'cancelled' : 'failed')
                return response
            }

            const streamingResponse = response as Extract<requestDataResponse, { type: 'streaming' }>
            const reader = streamingResponse.result.getReader()
            let lastResponseChunk: StreamResponseChunk = {}
            const trackedStream = new ReadableStream<StreamResponseChunk>({
                async pull(controller) {
                    try {
                        const { done, value } = await reader.read()
                        if (value) {
                            lastResponseChunk = value
                            controller.enqueue(value)
                        }
                        if (done) {
                            await finalize(
                                options.abortSignal?.aborted ? 'cancelled' : 'success',
                                getStreamOutput(lastResponseChunk),
                            )
                            controller.close()
                        }
                    }
                    catch (error) {
                        await finalize(
                            options.abortSignal?.aborted ? 'cancelled' : 'failed',
                            getStreamOutput(lastResponseChunk),
                        )
                        controller.error(error)
                    }
                },
                async cancel(reason) {
                    try {
                        await reader.cancel(reason)
                    }
                    finally {
                        await finalize('cancelled', getStreamOutput(lastResponseChunk))
                    }
                },
            })

            return {
                ...streamingResponse,
                result: trackedStream,
            }
        },
        async finalizeFailure() {
            await finalize(options.abortSignal?.aborted ? 'cancelled' : 'failed')
        },
        async finalizeAttempt(completedStatus: 'success' | 'failed') {
            await finalize(completedStatus)
        },
        async recordNextAttempt(completedStatus: 'success' | 'failed') {
            if (finalized) return
            await recordAttempt(completedStatus)
        },
    }
}
