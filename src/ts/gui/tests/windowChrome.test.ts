import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    createWindowChromeController,
    getNativeChromeAction,
    getTitleBarStorageKey,
    parseTitleBarStoredValue,
    type DesktopTitleBarPlatform,
    type WindowChromeDeps,
} from '../windowChrome.svelte'

const platformMocks = vi.hoisted(() => ({
    isTauri: false,
    osType: 'macos',
}))

vi.mock('../../platform', () => ({
    get isTauri() {
        return platformMocks.isTauri
    },
}))

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => platformMocks.osType,
    version: () => '',
}))

function createDeps(overrides: Partial<WindowChromeDeps> = {}) {
    const calls: string[] = []
    let stored: string | null = null
    const deps: WindowChromeDeps = {
        platform: 'windows',
        hideNativeChrome: async () => {
            calls.push('hide')
        },
        restoreNativeChrome: async () => {
            calls.push('restore')
        },
        readStoredPreference: () => stored,
        writeStoredPreference: (value) => {
            calls.push(`write:${value}`)
            stored = value
        },
        afterDomUpdate: async () => {
            calls.push('tick')
        },
        ...overrides,
    }
    const getCallCount = (name: string) => calls.filter((call) => call === name).length
    return { deps, calls, getStored: () => stored, getCallCount }
}

describe('storage format', () => {
    it('activates only for the exact string "true"', () => {
        expect(parseTitleBarStoredValue('true')).toBe(true)
        expect(parseTitleBarStoredValue('false')).toBe(false)
        expect(parseTitleBarStoredValue('TRUE')).toBe(false)
        expect(parseTitleBarStoredValue('1')).toBe(false)
        expect(parseTitleBarStoredValue('')).toBe(false)
        expect(parseTitleBarStoredValue(null)).toBe(false)
        expect(parseTitleBarStoredValue(undefined)).toBe(false)
    })

    it('builds a versioned per-platform storage key', () => {
        expect(getTitleBarStorageKey('macos')).toBe('risu.modern-desktop-titlebar.macos.v1')
        expect(getTitleBarStorageKey('windows')).toBe('risu.modern-desktop-titlebar.windows.v1')
        expect(getTitleBarStorageKey('linux')).toBe('risu.modern-desktop-titlebar.linux.v1')
    })
})

describe('native chrome mapping', () => {
    it('requests overlay to hide and visible to restore on macOS', () => {
        expect(getNativeChromeAction('macos', true)).toEqual({
            kind: 'title-bar-style',
            style: 'overlay',
        })
        expect(getNativeChromeAction('macos', false)).toEqual({
            kind: 'title-bar-style',
            style: 'visible',
        })
    })

    it('toggles decorations off/on on Windows and Linux', () => {
        for (const platform of ['windows', 'linux'] as const satisfies DesktopTitleBarPlatform[]) {
            expect(getNativeChromeAction(platform, true)).toEqual({
                kind: 'decorations',
                value: false,
            })
            expect(getNativeChromeAction(platform, false)).toEqual({
                kind: 'decorations',
                value: true,
            })
        }
    })
})

describe('window chrome controller', () => {
    it('stays disabled without a stored preference and never touches native chrome', async () => {
        const { deps, calls } = createDeps()
        const controller = createWindowChromeController(deps)

        expect(controller.init()).toBe(false)

        await controller.ensureApplied()

        expect(controller.isEnabled()).toBe(false)
        expect(calls).toEqual([])
    })

    it('treats missing and invalid stored values as disabled', () => {
        for (const raw of [null, '', 'false', 'TRUE']) {
            const { deps } = createDeps({ readStoredPreference: () => raw })
            const controller = createWindowChromeController(deps)
            expect(controller.init()).toBe(false)
        }
    })

    it('applies hidden chrome once after startup render', async () => {
        const { deps, getCallCount } = createDeps({ readStoredPreference: () => 'true' })
        const controller = createWindowChromeController(deps)

        expect(controller.init()).toBe(true)

        await controller.ensureApplied()
        expect(getCallCount('hide')).toBe(1)

        await controller.ensureApplied()
        expect(getCallCount('hide')).toBe(1)
    })

    it('enables UI first, waits, then hides native chrome', async () => {
        const { deps, calls } = createDeps()
        const controller = createWindowChromeController(deps)
        controller.init()

        const result = await controller.setEnabled(true)

        expect(result).toBe(true)
        expect(calls).toEqual(['write:true', 'tick', 'hide'])
    })

    it('restores native chrome before disabling the custom bar', async () => {
        const { deps, calls } = createDeps({ readStoredPreference: () => 'true' })
        const controller = createWindowChromeController(deps)
        controller.init()
        await controller.setEnabled(false)

        expect(controller.isEnabled()).toBe(false)
        expect(calls).toEqual(['restore', 'write:false'])
    })

    it('falls back to native chrome and rolls back storage when hiding fails', async () => {
        const { deps, calls, getStored } = createDeps({
            hideNativeChrome: async () => {
                throw new Error('apply failed')
            },
        })
        const controller = createWindowChromeController(deps)
        controller.init()

        const result = await controller.setEnabled(true)

        expect(result).toBe(false)
        expect(controller.isEnabled()).toBe(false)
        expect(getStored()).toBe('false')
        expect(calls).toContain('restore')
    })

    it('keeps the custom bar usable when restoring fails', async () => {
        const { deps, getStored } = createDeps({
            restoreNativeChrome: async () => {
                throw new Error('restore failed')
            },
        })
        const controller = createWindowChromeController(deps)
        controller.init()
        await controller.setEnabled(true)

        const result = await controller.setEnabled(false)

        expect(result).toBe(true)
        expect(controller.isEnabled()).toBe(true)
        expect(getStored()).toBe('true')
    })

    it('never enables on unsupported platforms', async () => {
        const { deps, calls, getStored } = createDeps({ platform: null })
        const controller = createWindowChromeController(deps)

        expect(controller.init()).toBe(false)

        const result = await controller.setEnabled(true)

        expect(result).toBe(false)
        expect(controller.isEnabled()).toBe(false)
        expect(calls).toEqual([])
        expect(getStored()).toBeNull()
    })

    it('serializes rapid consecutive toggles', async () => {
        const events: string[] = []
        let releaseHide!: () => void
        const hideGate = new Promise<void>((resolve) => {
            releaseHide = resolve
        })
        const { deps } = createDeps({
            hideNativeChrome: async () => {
                events.push('hide:start')
                await hideGate
                events.push('hide:end')
            },
            restoreNativeChrome: async () => {
                events.push('restore:start')
                events.push('restore:end')
            },
        })
        const controller = createWindowChromeController(deps)
        controller.init()

        const first = controller.setEnabled(true)
        const second = controller.setEnabled(false)
        releaseHide()
        await Promise.all([first, second])

        expect(events).toEqual(['hide:start', 'hide:end', 'restore:start', 'restore:end'])
        expect(controller.isEnabled()).toBe(false)
    })
})

describe('platform detection', () => {
    beforeEach(() => {
        vi.resetModules()
        platformMocks.isTauri = false
        platformMocks.osType = 'macos'
    })

    it('is always unavailable outside Tauri', async () => {
        platformMocks.isTauri = false
        platformMocks.osType = 'macos'
        const module = await import('../windowChrome.svelte')

        expect(module.getTauriDesktopPlatform()).toBeNull()
        expect(module.desktopTitleBarState.available).toBe(false)
        expect(module.windowChrome).toBeNull()
        expect(module.initDesktopTitleBar()).toBe(false)
    })

    it('detects supported desktop platforms inside Tauri', async () => {
        for (const osType of ['macos', 'windows', 'linux']) {
            vi.resetModules()
            platformMocks.isTauri = true
            platformMocks.osType = osType
            const module = await import('../windowChrome.svelte')

            expect(module.getTauriDesktopPlatform()).toBe(osType)
            expect(module.desktopTitleBarState.available).toBe(true)
            expect(module.windowChrome).not.toBeNull()
        }
    })

    it('does not expose mobile Tauri platforms', async () => {
        for (const osType of ['ios', 'android']) {
            vi.resetModules()
            platformMocks.isTauri = true
            platformMocks.osType = osType
            const module = await import('../windowChrome.svelte')

            expect(module.getTauriDesktopPlatform()).toBeNull()
            expect(module.desktopTitleBarState.available).toBe(false)
            expect(module.windowChrome).toBeNull()
        }
    })
})
