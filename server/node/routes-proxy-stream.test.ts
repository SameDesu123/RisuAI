import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { _test } = require('./routes-proxy-stream.cjs')

describe('node proxy stream target validation', () => {
    it('accepts local and private network http targets', () => {
        expect(_test.sanitizeTargetUrl('http://localhost:11434/v1/chat/completions')).toBe(
            'http://localhost:11434/v1/chat/completions'
        )
        expect(_test.sanitizeTargetUrl('https://192.168.0.10:8443/api')).toBe(
            'https://192.168.0.10:8443/api'
        )
        expect(_test.sanitizeTargetUrl('http://model-server.local/v1')).toBe(
            'http://model-server.local/v1'
        )
    })

    it('rejects public, non-http, and invalid targets', () => {
        expect(_test.sanitizeTargetUrl('https://api.openai.com/v1/chat/completions')).toBeNull()
        expect(_test.sanitizeTargetUrl('http://8.8.8.8:8080')).toBeNull()
        expect(_test.sanitizeTargetUrl('ftp://localhost/file')).toBeNull()
        expect(_test.sanitizeTargetUrl('not-a-url')).toBeNull()
        expect(_test.sanitizeTargetUrl('')).toBeNull()
    })

    it('strips userinfo from accepted targets', () => {
        expect(_test.sanitizeTargetUrl('http://user:pass@localhost:11434/v1')).toBe(
            'http://localhost:11434/v1'
        )
    })

    it('keeps bare service names blocked on the node relay path', () => {
        expect(_test.isLocalNetworkHost('litellm')).toBe(false)
    })

    it('keeps bracketed IPv6 URLs blocked by the current sanitizer behavior', () => {
        expect(_test.isLocalNetworkHost('fd00::1')).toBe(true)
        expect(_test.sanitizeTargetUrl('http://[fd00::1]:4000/v1')).toBeNull()
    })
})

describe('node proxy stream forwarded headers', () => {
    it('drops proxy control headers and keeps string headers', () => {
        expect(_test.normalizeForwardHeaders({
            authorization: 'Bearer token',
            'content-length': '123',
            connection: 'keep-alive',
            host: 'example.com',
            'risu-auth': 'secret',
            'risu-timeout-ms': '1000',
            'x-custom': 'ok',
            ignored: 1,
        })).toEqual({
            authorization: 'Bearer token',
            'x-custom': 'ok',
        })
    })

    it('normalizes timeout and heartbeat bounds', () => {
        expect(_test.normalizeProxyStreamTimeoutMs(0)).toBe(600000)
        expect(_test.normalizeProxyStreamTimeoutMs(999999999)).toBe(3600000)
        expect(_test.normalizeHeartbeatSec(1)).toBe(5)
        expect(_test.normalizeHeartbeatSec(999)).toBe(60)
        expect(_test.normalizeHeartbeatSec(Number.NaN)).toBe(15)
    })
})
