const openRouterHostname = 'openrouter.ai'
const openRouterAttributionApplied = Symbol('openRouterAttributionApplied')

type ProcessedOpenRouterHeaders = Record<string, string> & {
    [openRouterAttributionApplied]?: true
}

function toHeaderRecord(currentHeaders: HeadersInit): Record<string, string> {
    if(typeof Headers !== 'undefined' && currentHeaders instanceof Headers){
        return Object.fromEntries(currentHeaders.entries())
    }
    if(Array.isArray(currentHeaders)){
        return Object.fromEntries(currentHeaders)
    }
    return { ...currentHeaders }
}

export function withOpenRouterAttributionHeaders(
    url: string,
    currentHeaders?: Record<string, string>,
): Record<string, string>
export function withOpenRouterAttributionHeaders(
    url: string,
    currentHeaders: HeadersInit,
): HeadersInit
export function withOpenRouterAttributionHeaders(
    url: string,
    currentHeaders: HeadersInit = {},
): HeadersInit {
    let hostname: string
    try {
        hostname = new URL(url).hostname.toLowerCase()
    } catch {
        return currentHeaders
    }

    if(hostname !== openRouterHostname && !hostname.endsWith(`.${openRouterHostname}`)){
        return currentHeaders
    }

    if((currentHeaders as ProcessedOpenRouterHeaders)[openRouterAttributionApplied]){
        return currentHeaders
    }

    const headers = toHeaderRecord(currentHeaders) as ProcessedOpenRouterHeaders
    const headerNames = new Set(Object.keys(headers).map((name) => name.toLowerCase()))

    if(!headerNames.has('http-referer')){
        headers['HTTP-Referer'] = 'https://risuai.xyz'
    }
    if(!headerNames.has('x-openrouter-title') && !headerNames.has('x-title')){
        headers['X-OpenRouter-Title'] = 'RisuAI'
    }

    Object.defineProperty(headers, openRouterAttributionApplied, { value: true })

    return headers
}
