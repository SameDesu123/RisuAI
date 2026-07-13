import DOMPurify from 'dompurify'

const forbiddenUrl = /^(?:https?:|\/\/|javascript:|vbscript:)/i

export function sanitizeBotUiCss(input: string): string {
    return input
        .replace(/@import\s+(?:url\([^)]*\)|[^;]+);?/gi, '')
        .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_full, _quote, url: string) => {
            const value = url.trim()
            return /^(?:blob:|data:)/i.test(value) ? `url("${value.replaceAll('"', '%22')}")` : 'url("")'
        })
}

export function sanitizeBotUiHtml(input: string): string {
    const purifier = DOMPurify(window)
    const clean = purifier.sanitize(input, {
        FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'base', 'link', 'meta'],
        FORBID_ATTR: ['srcdoc', 'formaction', 'action', 'target'],
        ADD_ATTR: ['data-risu-action'],
    })
    const doc = new DOMParser().parseFromString(clean, 'text/html')
    for(const style of doc.body.querySelectorAll('style')) style.textContent = sanitizeBotUiCss(style.textContent ?? '')
    for(const element of doc.body.querySelectorAll('*')){
        for(const attribute of [...element.attributes]){
            const name = attribute.name.toLowerCase()
            const value = attribute.value.trim()
            if(name.startsWith('on')){
                element.removeAttribute(attribute.name)
                continue
            }
            if(['href', 'src', 'poster', 'xlink:href'].includes(name) && (forbiddenUrl.test(value) || (!/^(?:blob:|data:|#)/i.test(value) && value !== ''))){
                element.removeAttribute(attribute.name)
            }
            if(name === 'style') element.setAttribute('style', sanitizeBotUiCss(value))
        }
    }
    return doc.body.innerHTML
}

export function expandBotUiCbs(input: string, parser: (value: string) => string, maxPasses = 4): string {
    let current = input
    for(let pass = 0; pass < maxPasses; pass++){
        const next = parser(current)
        if(next === current) return next
        current = next
    }
    if(parser(current) !== current) throw new Error(`Bot UI CBS expansion exceeded ${maxPasses} passes`)
    return current
}

export function tokenizeBotUiActions(input: string): { html: string, actions: Map<string, string> } {
    const doc = new DOMParser().parseFromString(input, 'text/html')
    const actions = new Map<string, string>()
    let counter = 0
    for(const element of doc.body.querySelectorAll('[risu-trigger], [risu-btn]')){
        const action = element.getAttribute('risu-trigger') ?? element.getAttribute('risu-btn')
        element.removeAttribute('risu-trigger')
        element.removeAttribute('risu-btn')
        if(!action) continue
        const token = `action-${counter++}-${crypto.randomUUID()}`
        actions.set(token, action)
        element.setAttribute('data-risu-action', token)
        if(element instanceof HTMLButtonElement) element.type = 'button'
    }
    return { html: doc.body.innerHTML, actions }
}
