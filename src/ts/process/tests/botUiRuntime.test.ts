import { afterEach, describe, expect, test, vi } from 'vitest'
import { buildLuaEngineContextPrefix, buildLuaEngineKey, buildLuaRuntimeContextSignature } from '../luaEngineIdentity'
import { indexBotUiAssets } from '../botUiAssets'
import { leaseResource, releaseResource, retireResource } from '../deferredDisposal'
import { createContextualChatVarAccessors } from '../contextualChatVars'
import { expandBotUiCbs, sanitizeBotUiCss, sanitizeBotUiHtml, tokenizeBotUiActions } from '../botUiSecurity'

afterEach(() => vi.unstubAllGlobals())

describe('Bot UI compiler primitives', () => {
    test('expands a button inserted by a ChatVar pass and hides its Lua function behind a token', () => {
        vi.stubGlobal('crypto', { randomUUID: () => 'test-token' })
        const parser = (value: string) => value
            .replace('{{getvar::panel}}', '{{button::Open NPC::toggleNpc}}')
            .replace('{{button::Open NPC::toggleNpc}}', '<button risu-trigger="toggleNpc">Open NPC</button>')

        const expanded = expandBotUiCbs('<section>{{getvar::panel}}</section>', parser)
        const compiled = tokenizeBotUiActions(expanded)

        expect(compiled.html).toContain('data-risu-action="action-0-test-token"')
        expect(compiled.html).not.toContain('risu-trigger')
        expect(compiled.html).not.toContain('toggleNpc')
        expect(compiled.actions.get('action-0-test-token')).toBe('toggleNpc')
    })

    test('enforces the recursive CBS pass limit', () => {
        expect(() => expandBotUiCbs('0', (value) => `${value}x`, 4)).toThrow('exceeded 4 passes')
    })

    test('removes executable markup and external URLs while preserving inline UI styles', () => {
        const html = sanitizeBotUiHtml(`
            <script>alert(1)</script>
            <style>@import url(https://bad.example/a.css); .ok { animation: fade 1s }</style>
            <button onclick="alert(1)" data-risu-action="safe">Open</button>
            <img src="https://bad.example/a.png">
        `)

        expect(html).not.toContain('<script')
        expect(html).not.toContain('onclick')
        expect(html).not.toContain('bad.example')
        expect(html).toContain('data-risu-action="safe"')
        expect(html).toContain('animation: fade 1s')
        expect(sanitizeBotUiHtml('<div class="creator-panel"></div>')).toContain('class="creator-panel"')
    })

    test('keeps blob assets and keyframes but strips imports and network CSS URLs', () => {
        const css = sanitizeBotUiCss(`
            @import "https://bad.example/theme.css";
            .remote { background: url(https://bad.example/image.png) }
            .local { background: url(blob:test) }
            @keyframes pulse { from { opacity: 0 } to { opacity: 1 } }
        `)

        expect(css).not.toContain('bad.example')
        expect(css).toContain('url("blob:test")')
        expect(css).toContain('@keyframes pulse')
    })
})

describe('Bot UI assets', () => {
    test('prefers character assets, then active module order, then first duplicate in a source', () => {
        const index = indexBotUiAssets(
            [['portrait', 'character-path', 'png'], ['portrait', 'character-duplicate', 'jpg']],
            [['portrait', 'module-path', 'webp'], ['music', 'module-one', 'mp3']],
            [['music', 'module-two', 'wav']],
        )

        expect(index.get('portrait')?.[1]).toBe('character-path')
        expect(index.get('music')?.[1]).toBe('module-one')
    })
})

describe('Lua engine identity', () => {
    test('uses the same key for lifecycle and button calls in one chat', () => {
        const lifecycle = buildLuaEngineKey({ characterId: 'char', chatPage: 2, source: 'character', triggerIndex: 0 })
        const action = buildLuaEngineKey({ characterId: 'char', chatPage: 2, source: 'character', triggerIndex: 0 })
        const otherModule = buildLuaEngineKey({ characterId: 'char', chatPage: 2, source: 'module:other', triggerIndex: 0 })

        expect(lifecycle).toBe(action)
        expect(otherModule).not.toBe(action)
    })

    test('builds a context prefix that only matches one character and chat', () => {
        const prefix = buildLuaEngineContextPrefix({ characterId: 'char-a', chatId: 'chat-a' })
        const sameContext = buildLuaEngineKey({ characterId: 'char-a', chatId: 'chat-a', source: 'character', triggerIndex: 0 })
        const otherChat = buildLuaEngineKey({ characterId: 'char-a', chatId: 'chat-b', source: 'character', triggerIndex: 0 })

        expect(sameContext.startsWith(prefix)).toBe(true)
        expect(otherChat.startsWith(prefix)).toBe(false)
    })

    test('changes the runtime signature when active modules change', () => {
        const prefix = buildLuaEngineContextPrefix({ characterId: 'char-a', chatId: 'chat-a' })
        expect(buildLuaRuntimeContextSignature(prefix, ['module-a']))
            .not.toBe(buildLuaRuntimeContextSignature(prefix, ['module-b']))
    })
})

describe('Lua engine retirement', () => {
    test('waits for every active call and disposes exactly once', () => {
        const state = { leases: 0 }
        const dispose = vi.fn()
        expect(leaseResource(state)).toBe(true)
        expect(leaseResource(state)).toBe(true)

        retireResource(state, dispose)
        expect(dispose).not.toHaveBeenCalled()
        expect(leaseResource(state)).toBe(false)

        releaseResource(state, dispose)
        expect(dispose).not.toHaveBeenCalled()
        releaseResource(state, dispose)
        releaseResource(state, dispose)
        expect(dispose).toHaveBeenCalledTimes(1)
    })

    test('keeps deferred ChatVar writes on the chat that started the call', () => {
        const originalChat = { scriptstate: { $gold: 10 } }
        const newSelectedChat = { scriptstate: { $gold: 999 } }
        const vars = createContextualChatVarAccessors(originalChat, () => [['default', 'value']])

        vars.setVar('gold', '20')

        expect(vars.getVar('gold')).toBe('20')
        expect(vars.getVar('default')).toBe('value')
        expect(newSelectedChat.scriptstate.$gold).toBe(999)
    })
})
