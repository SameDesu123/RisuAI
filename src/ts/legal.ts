type RisuRuntimeConfig = {
    legalConfigured?: unknown
}

const enabledValues = new Set(['true', '1', 'yes', 'y', 'on'])

function isEnabledFlag(value: unknown): boolean {
    if (value === true) {
        return true
    }

    if (typeof value !== 'string') {
        return false
    }

    return enabledValues.has(value.trim().toLowerCase())
}

const runtimeConfig = (globalThis as typeof globalThis & {
    __RISU_RUNTIME_CONFIG__?: RisuRuntimeConfig
}).__RISU_RUNTIME_CONFIG__

export const isLegalConfigured =
    isEnabledFlag(import.meta.env.VITE_RISU_LEGAL_CONFIGURED) ||
    isEnabledFlag(runtimeConfig?.legalConfigured)
