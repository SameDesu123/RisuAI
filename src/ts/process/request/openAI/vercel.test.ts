import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyVercelGatewayOptions } from './vercel'

const db = vi.hoisted(() => ({
    vercelGateway: {
        order: [] as string[],
        only: [] as string[],
        sort: 'auto' as 'auto' | 'cost' | 'ttft' | 'tps',
        serviceTier: 'default' as 'default' | 'priority' | 'flex',
        zeroDataRetention: false,
        disallowPromptTraining: false,
        automaticCaching: false,
    },
}))

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => db,
}))

describe('Vercel AI Gateway request options', () => {
    beforeEach(() => {
        db.vercelGateway = {
            order: [],
            only: [],
            sort: 'auto',
            serviceTier: 'default',
            zeroDataRetention: false,
            disallowPromptTraining: false,
            automaticCaching: false,
        }
    })

    it('omits providerOptions when all settings use defaults', () => {
        expect(applyVercelGatewayOptions({ model: 'openai/gpt-5' }, 'vercel')).toEqual({ model: 'openai/gpt-5' })
    })

    it('normalizes routing lists and emits all enabled options', () => {
        db.vercelGateway = {
            order: [' azure ', '', 'openai', 'azure'],
            only: ['openai', ' azure '],
            sort: 'cost',
            serviceTier: 'priority',
            zeroDataRetention: true,
            disallowPromptTraining: true,
            automaticCaching: true,
        }

        expect(applyVercelGatewayOptions({ model: 'openai/gpt-5' }, 'vercel')).toEqual({
            model: 'openai/gpt-5',
            providerOptions: {
                gateway: {
                    order: ['azure', 'openai'],
                    only: ['openai', 'azure'],
                    sort: 'cost',
                    serviceTier: 'priority',
                    zeroDataRetention: true,
                    disallowPromptTraining: true,
                    caching: 'auto',
                },
            },
        })
    })

    it('does not alter other providers', () => {
        db.vercelGateway.zeroDataRetention = true
        const body = { model: 'gpt-5' }
        expect(applyVercelGatewayOptions(body, 'gpt-5')).toBe(body)
        expect(body).toEqual({ model: 'gpt-5' })
    })
})
