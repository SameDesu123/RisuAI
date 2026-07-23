const openRouterHostname = 'openrouter.ai'

export function withOpenRouterAttributionHeaders(
    url: string,
    currentHeaders: Record<string, string> = {},
): Record<string, string> {
    let hostname: string
    try {
        hostname = new URL(url).hostname.toLowerCase()
    } catch {
        return currentHeaders
    }

    if(hostname !== openRouterHostname && !hostname.endsWith(`.${openRouterHostname}`)){
        return currentHeaders
    }

    const headers = { ...currentHeaders }
    const headerNames = new Set(Object.keys(headers).map((name) => name.toLowerCase()))

    if(!headerNames.has('http-referer')){
        headers['HTTP-Referer'] = 'https://risuai.xyz'
    }
    if(!headerNames.has('x-openrouter-title') && !headerNames.has('x-title')){
        headers['X-OpenRouter-Title'] = 'RisuAI'
    }

    return headers
}
