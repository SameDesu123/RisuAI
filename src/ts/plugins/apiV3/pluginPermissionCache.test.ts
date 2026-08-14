import { describe, expect, it } from 'vitest'
import {
    createPluginScriptHashGetter,
    getPluginPermissionKey,
    PluginPermissionSessionCache,
} from './pluginPermissionCache'

describe('createPluginScriptHashGetter', () => {
    it('hashes the loaded plugin script only once', async () => {
        let hashCalls = 0
        const getScriptHash = createPluginScriptHashGetter('plugin-script', async (data) => {
            hashCalls++
            expect(new TextDecoder().decode(data)).toBe('plugin-script')
            return 'script-hash'
        })

        expect(hashCalls).toBe(0)

        const hashes = await Promise.all([
            getScriptHash(),
            getScriptHash(),
            getScriptHash(),
        ])

        expect(hashes).toEqual(['script-hash', 'script-hash', 'script-hash'])
        expect(hashCalls).toBe(1)
    })
})

describe('PluginPermissionSessionCache', () => {
    it('keeps permission decisions isolated by permission', () => {
        const cache = new PluginPermissionSessionCache()

        cache.set('script-hash', 'fetchLogs', true)

        expect(cache.get('script-hash', 'fetchLogs')).toBe(true)
        expect(cache.get('script-hash', 'db')).toBeUndefined()
    })

    it('keeps denied permissions from blocking other permissions', () => {
        const cache = new PluginPermissionSessionCache()

        cache.set('script-hash', 'mainDom', false)

        expect(cache.get('script-hash', 'mainDom')).toBe(false)
        expect(cache.get('script-hash', 'sendChat')).toBeUndefined()
    })

    it('invalidates session decisions when the plugin script changes', () => {
        const cache = new PluginPermissionSessionCache()

        cache.set('old-script-hash', 'db', true)

        expect(cache.get('old-script-hash', 'db')).toBe(true)
        expect(cache.get('new-script-hash', 'db')).toBeUndefined()
    })

    it('preserves the existing persistent permission key format', () => {
        expect(getPluginPermissionKey('script-hash', 'provider')).toBe('script-hash_provider')
    })
})
