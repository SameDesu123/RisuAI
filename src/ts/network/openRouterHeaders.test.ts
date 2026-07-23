import { describe, expect, it } from 'vitest'

import { withOpenRouterAttributionHeaders } from './openRouterHeaders'

describe('withOpenRouterAttributionHeaders', () => {
    it('adds attribution headers for OpenRouter and its subdomains', () => {
        expect(withOpenRouterAttributionHeaders('https://openrouter.ai/api/v1/chat/completions')).toEqual({
            'HTTP-Referer': 'https://risuai.xyz',
            'X-OpenRouter-Title': 'RisuAI',
        })
        expect(withOpenRouterAttributionHeaders('https://api.openrouter.ai/v1/models')).toEqual({
            'HTTP-Referer': 'https://risuai.xyz',
            'X-OpenRouter-Title': 'RisuAI',
        })
    })

    it('does not modify requests to other or misleading hosts', () => {
        const headers = { Authorization: 'Bearer test-key' }

        expect(withOpenRouterAttributionHeaders('https://example.com/v1/chat', headers)).toBe(headers)
        expect(withOpenRouterAttributionHeaders('https://openrouter.ai.example.com/v1/chat', headers)).toBe(headers)
        expect(withOpenRouterAttributionHeaders('not-a-url', headers)).toBe(headers)
    })

    it('preserves custom attribution headers without regard to casing', () => {
        const headers = {
            Authorization: 'Bearer test-key',
            'http-referer': 'https://plugin.example',
            'x-openrouter-title': 'Plugin App',
        }

        expect(withOpenRouterAttributionHeaders('https://openrouter.ai/api/v1/chat/completions', headers)).toEqual(headers)
        expect(headers).toEqual({
            Authorization: 'Bearer test-key',
            'http-referer': 'https://plugin.example',
            'x-openrouter-title': 'Plugin App',
        })
    })

    it('treats the legacy X-Title header as a custom title', () => {
        const result = withOpenRouterAttributionHeaders('https://openrouter.ai/api/v1/chat/completions', {
            'X-Title': 'Legacy Plugin App',
        })

        expect(result).toEqual({
            'X-Title': 'Legacy Plugin App',
            'HTTP-Referer': 'https://risuai.xyz',
        })
        expect(result).not.toHaveProperty('X-OpenRouter-Title')
    })
})
