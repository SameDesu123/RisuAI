<script lang="ts">
    import { XIcon } from '@lucide/svelte'
    import { onDestroy, onMount } from 'svelte'
    import { get } from 'svelte/store'
    import { language } from 'src/lang'
    import { compileBotUi, botUiFrameSource, botUiInvalidation, botUiPanelOpen, type CompiledBotUi } from 'src/ts/process/botUiRuntime'
    import { getLuaEngineContextPrefix, getLuaRuntimeContextSignature, retireLuaEngines, runLuaActionTrigger } from 'src/ts/process/scriptings'
    import { DBState, selectedCharID } from 'src/ts/stores.svelte'

    let iframe: HTMLIFrameElement = $state()
    let compiled: CompiledBotUi|null = null
    let error = $state('')
    let busy = $state(false)
    let revision = 0
    let ready = false
    let lastContext = ''
    let lastEngineContext = ''
    let openedContext = ''
    let unsubscribe: (() => void)|undefined

    const char = $derived(DBState.db.characters[$selectedCharID])
    const config = $derived(char?.type === 'character' ? char.botUi : undefined)

    const panelStyle = $derived.by(() => {
        const layout = config?.layout ?? {}
        const width = Math.max(280, layout.width ?? 480)
        const height = Math.max(240, layout.height ?? 640)
        const x = layout.offsetX ?? 16
        const y = layout.offsetY ?? 16
        const anchor = layout.anchor ?? 'bottom-right'
        let position = ''
        const safeX = `clamp(0px,${Math.max(0, x)}px,calc(100vw - 296px))`
        const safeY = `clamp(0px,${Math.max(0, y)}px,calc(100vh - 256px))`
        if(anchor === 'top-left') position = `left:${safeX};top:${safeY};`
        if(anchor === 'top-right') position = `right:${safeX};top:${safeY};`
        if(anchor === 'bottom-left') position = `left:${safeX};bottom:${safeY};`
        if(anchor === 'bottom-right') position = `right:${safeX};bottom:${safeY};`
        if(anchor === 'center') position = 'left:50%;top:50%;transform:translate(-50%,-50%);'
        return `${position}width:min(${width}px,calc(100vw - 32px));height:min(${height}px,calc(100vh - 32px));`
    })

    function closePanel() {
        botUiPanelOpen.set(false)
        compiled?.dispose()
        compiled = null
        error = ''
        ready = false
        openedContext = ''
    }

    async function renderPanel() {
        if(!config || char?.type !== 'character' || !get(botUiPanelOpen)) return
        const requestRevision = ++revision
        try {
            const next = await compileBotUi(char)
            if(requestRevision !== revision || !get(botUiPanelOpen)){
                next.dispose()
                return
            }
            const previous = compiled
            compiled = next
            error = ''
            previous?.dispose()
            if(ready){
                iframe.contentWindow?.postMessage({ type: 'risu-bot-ui-render', revision, html: next.html, css: next.css }, '*')
            }
        } catch(cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        }
    }

    async function runAction(action: string) {
        if(busy || char?.type !== 'character') return
        busy = true
        iframe?.contentWindow?.postMessage({ type: 'risu-bot-ui-busy', busy: true }, '*')
        const invalidationBefore = get(botUiInvalidation)
        try {
            await runLuaActionTrigger(char, action)
            if(get(botUiInvalidation) === invalidationBefore) await renderPanel()
        } catch(cause) {
            error = cause instanceof Error ? cause.message : String(cause)
        } finally {
            busy = false
            iframe?.contentWindow?.postMessage({ type: 'risu-bot-ui-busy', busy: false }, '*')
        }
    }

    function handleMessage(event: MessageEvent) {
        if(event.source !== iframe?.contentWindow || !event.data) return
        if(event.data.type === 'risu-bot-ui-ready'){
            ready = true
            if(compiled) iframe.contentWindow?.postMessage({ type: 'risu-bot-ui-render', revision, html: compiled.html, css: compiled.css }, '*')
            return
        }
        if(event.data.type !== 'risu-bot-ui-action' || event.data.revision !== revision || busy) return
        const action = compiled?.actions.get(event.data.token)
        if(action) runAction(action)
    }

    onMount(() => {
        window.addEventListener('message', handleMessage)
        unsubscribe = botUiInvalidation.subscribe(() => {
            if(get(botUiPanelOpen)) renderPanel()
        })
    })

    onDestroy(() => {
        window.removeEventListener('message', handleMessage)
        unsubscribe?.()
        compiled?.dispose()
    })

    $effect(() => {
        const isOpen = $botUiPanelOpen
        const context = char?.type === 'character'
            ? getLuaRuntimeContextSignature(char, char.chats[char.chatPage])
            : ''
        const engineContext = char?.type === 'character'
            ? getLuaEngineContextPrefix(char, char.chats[char.chatPage])
            : ''
        if(lastContext && context !== lastContext){
            closePanel()
            if(lastEngineContext) retireLuaEngines(lastEngineContext)

            lastContext = context
            lastEngineContext = engineContext
            return
        }
        lastContext = context
        lastEngineContext = engineContext

        if(isOpen && config?.html?.trim()){
            if(openedContext !== context){
                openedContext = context
                const openAction = config.openAction?.trim()
                if(openAction){
                    runAction(openAction)
                } else {
                    renderPanel()
                }
            }
        }
    })
</script>

{#if $botUiPanelOpen && config?.html?.trim() && char?.type === 'character'}
    <section class="bot-ui-panel fixed z-50 flex flex-col rounded-lg border border-darkborderc bg-bgcolor shadow-2xl overflow-hidden" style={panelStyle} aria-label="Bot UI">
        <header class="h-10 shrink-0 flex items-center justify-between border-b border-darkborderc bg-darkbg px-3 text-textcolor">
            <span class="truncate font-medium">{char.name} · Bot UI</span>
            <div class="flex items-center gap-2">
                {#if busy}<span class="text-xs text-textcolor2">{language.loading}</span>{/if}
                <button class="p-1 rounded hover:bg-darkbutton" onclick={closePanel} aria-label="Close"><XIcon size={18} /></button>
            </div>
        </header>
        {#if error}
            <div class="shrink-0 bg-draculared/15 border-b border-draculared/40 px-3 py-2 text-xs text-textcolor">{error}</div>
        {/if}
        <iframe bind:this={iframe} title="Bot UI" sandbox="allow-scripts" srcdoc={botUiFrameSource} class="min-h-0 grow w-full border-0 bg-transparent" class:opacity-60={busy} onload={() => {
            ready = true
            if(compiled) iframe.contentWindow?.postMessage({ type: 'risu-bot-ui-render', revision, html: compiled.html, css: compiled.css }, '*')
        }}></iframe>
    </section>
{/if}

<style>
    @media (max-width: 640px) {
        .bot-ui-panel {
            inset: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left) !important;
            width: auto !important;
            height: auto !important;
            transform: none !important;
            border-radius: 0;
        }
    }
</style>
