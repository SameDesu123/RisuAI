import { readImage } from '../globalApi.svelte'
import { risuChatParser } from '../parser/parser.svelte'
import type { character } from '../storage/database.svelte'
import { getModuleAssets } from './modules'
import { expandBotUiCbs, sanitizeBotUiCss, sanitizeBotUiHtml, tokenizeBotUiActions } from './botUiSecurity'
import { indexBotUiAssets } from './botUiAssets'
export { botUiInvalidation, botUiPanelOpen } from './botUiSignals'
export { sanitizeBotUiCss, sanitizeBotUiHtml } from './botUiSecurity'

export interface CompiledBotUi {
    html: string
    css: string
    actions: Map<string, string>
    dispose: () => void
}

const assetMacro = /\{\{(raw|path|image|img|video|audio|asset)::([^{}]+?)\}\}/gi

function mimeFromExtension(extension: string): string {
    const ext = extension.toLowerCase().replace(/^\./, '')
    if(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext}`
    if(['mp4', 'webm', 'ogg'].includes(ext)) return `video/${ext}`
    if(['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) return `audio/${ext === 'mp3' ? 'mpeg' : ext}`
    return 'application/octet-stream'
}

function mediaTag(kind: string, url: string, extension: string): string {
    if(kind === 'raw' || kind === 'path') return url
    if(kind === 'image' || kind === 'img') return `<img src="${url}" alt="" />`
    if(kind === 'video') return `<video src="${url}" controls></video>`
    if(kind === 'audio') return `<audio src="${url}" controls></audio>`
    const mime = mimeFromExtension(extension)
    if(mime.startsWith('video/')) return `<video src="${url}" controls></video>`
    if(mime.startsWith('audio/')) return `<audio src="${url}" controls></audio>`
    return `<img src="${url}" alt="" />`
}

async function resolveAssets(input: string, char: character, objectUrls: string[]): Promise<string> {
    const byName = indexBotUiAssets(char.additionalAssets ?? [], getModuleAssets())
    const cache = new Map<string, string>()
    const matches = [...input.matchAll(assetMacro)]
    let output = input
    for(const match of matches){
        const [full, kind, requestedName] = match
        const asset = byName.get(requestedName.trim().toLocaleLowerCase())
        if(!asset){
            output = output.replace(full, '')
            continue
        }
        let url = cache.get(asset[1])
        if(!url){
            const bytes = await readImage(asset[1])
            if(!bytes) {
                output = output.replace(full, '')
                continue
            }
            const bytesCopy = bytes.slice().buffer as ArrayBuffer
            url = URL.createObjectURL(new Blob([bytesCopy], { type: mimeFromExtension(asset[2]) }))
            cache.set(asset[1], url)
            objectUrls.push(url)
        }
        output = output.replace(full, mediaTag(kind.toLowerCase(), url, asset[2]))
    }
    return output
}

function compileCbs(input: string, char: character): string {
    return expandBotUiCbs(input, (value) => risuChatParser(value, { chara: char, visualize: true }))
}

export async function compileBotUi(char: character): Promise<CompiledBotUi> {
    const config = char.botUi
    if(!config) throw new Error('Bot UI is not configured')
    const objectUrls: string[] = []
    try {
        const expandedHtml = compileCbs(config.html, char)
        const expandedCss = compileCbs(config.css ?? '', char)
        const withAssetsHtml = await resolveAssets(expandedHtml, char, objectUrls)
        const withAssetsCss = await resolveAssets(expandedCss, char, objectUrls)
        const tokenized = tokenizeBotUiActions(withAssetsHtml)
        return {
            html: sanitizeBotUiHtml(tokenized.html),
            css: sanitizeBotUiCss(withAssetsCss),
            actions: tokenized.actions,
            dispose: () => objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url)),
        }
    } catch(error) {
        objectUrls.forEach((url) => URL.revokeObjectURL(url))
        throw error
    }
}

export const botUiFrameSource = `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; media-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; navigate-to 'none';"><style id="creator-style"></style></head>
<body><main id="root"></main><script>
(() => {
  const root = document.getElementById('root');
  const style = document.getElementById('creator-style');
  let revision = 0;
  addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.type === 'risu-bot-ui-busy') {
      root.querySelectorAll('[data-risu-action]').forEach((element) => { element.disabled = Boolean(data.busy); });
      return;
    }
    if (!data || data.type !== 'risu-bot-ui-render' || data.revision < revision) return;
    revision = data.revision;
    style.textContent = data.css || '';
    root.innerHTML = data.html || '';
  });
  addEventListener('click', (event) => {
    const target = event.target.closest('[data-risu-action]');
    if (!target || target.hasAttribute('disabled')) return;
    parent.postMessage({ type: 'risu-bot-ui-action', token: target.dataset.risuAction, revision }, '*');
  });
  addEventListener('submit', (event) => event.preventDefault());
  parent.postMessage({ type: 'risu-bot-ui-ready' }, '*');
})();
</script></body></html>`
