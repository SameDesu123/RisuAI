<script lang="ts">
    import { alertGenerationInfoStore, showLegacyRequestLogs } from "../../ts/alert";
    
    import { DBState } from 'src/ts/stores.svelte';
    import { getCharImage } from '../../ts/characters';
    import { ParseMarkdown } from '../../ts/parser/parser.svelte';
    import BarIcon from '../SideBars/BarIcon.svelte';
    import { ChevronRightIcon, User } from '@lucide/svelte';
    import { hubURL, isCharacterHasAssets } from 'src/ts/characterCards';
    import TextInput from '../UI/GUI/TextInput.svelte';
    import { aiLawApplies, openURL, getFetchLogs } from 'src/ts/globalApi.svelte';
    import Button from '../UI/GUI/Button.svelte';
    import { XIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, CheckIcon } from "@lucide/svelte";
    import hljs from 'highlight.js/lib/core';
    import json from 'highlight.js/lib/languages/json';
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import OptionInput from "../UI/GUI/OptionInput.svelte";
    import { language } from 'src/lang';
    import { getFetchData } from 'src/ts/globalApi.svelte';
    import { alertStore, selectedCharID } from "src/ts/stores.svelte";
    import { tokenize } from "src/ts/tokenizer";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import ModuleChatMenu from "../Setting/Pages/Module/ModuleChatMenu.svelte";
    import { ColorSchemeTypeStore } from "src/ts/gui/colorscheme";
    import Help from "./Help.svelte";
    import { getChatBranches } from "src/ts/gui/branches";
    import { getCurrentCharacter } from "src/ts/storage/database.svelte";
    import { translateStackTrace } from "../../ts/sourcemap";
    import versionData from "../../../version.json";

    let showDetails = $state(false);
    let translatedStackTrace = $state('');
    let stackTraceTranslationFailed = $state(false);
    let isTranslating = $state(false);
    const displayedStackTrace = $derived(translatedStackTrace || $alertStore.stackTrace || '');
    const risuVersion = versionData.version;
    const stackTraceCodeBlock = $derived.by(() => {
        const lines = [`Risu version: ${risuVersion}`]

        if (stackTraceTranslationFailed) {
            lines.push(language.stackTraceTranslationFailed)
        } else if (isTranslating) {
            lines.push(language.translating)
        }

        if (displayedStackTrace) {
            lines.push('', displayedStackTrace)
        }

        return lines.join('\n')
    });

    let btn
    let input = $state('')
    let cardExportType = $state('realm')
    let cardExportType2 = $state('')
    let cardLicense = $state('')
    let generationInfoMenuIndex = $state(0)
    let branchHover:null|{
        x:number,
        y:number,
        content:string,
    } = $state(null)
    let expandedLogs: Set<string> = $state(new Set())
    let copiedKey: string | null = $state(null)
    let logSearch = $state('')
    let logFilter: 'all' | 'success' | 'error' = $state('all')
    let activeLogTab: Map<string, 'request' | 'response'> = $state(new Map())

    type ViewerRequestLog = ReturnType<typeof getFetchLogs>[number] & {
        method: string
    }

    // Register JSON language for syntax highlighting
    if (!hljs.getLanguage('json')) {
        hljs.registerLanguage('json', json)
    }

    function highlightJson(code: string | undefined | null): string {
        if (!code) return ''
        try {
            return hljs.highlight(code, { language: 'json' }).value
        } catch {
            return code.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        }
    }

    async function copyToClipboard(text: string, key: string) {
        try {
            await navigator.clipboard.writeText(text)
        } catch {
            // fallback
            const textarea = document.createElement('textarea')
            textarea.value = text
            document.body.appendChild(textarea)
            textarea.select()
            document.execCommand('copy')
            document.body.removeChild(textarea)
        }
        copiedKey = key
        setTimeout(() => {
            if (copiedKey === key) copiedKey = null
        }, 1500)
    }
    $effect.pre(() => {
        showDetails = false;
        translatedStackTrace = '';
        stackTraceTranslationFailed = false;
        isTranslating = false;
        if(btn){
            btn.focus()
        }
        if($alertStore.type !== 'input'){
            input = ''
        }
        if($alertStore.type !== 'branches'){
            branchHover = null
        }
        if($alertStore.type !== 'cardexport'){
            cardExportType = 'realm'
            cardExportType2 = ''
            cardLicense = ''
        }
        if($alertStore.type !== 'requestlogs'){
            expandedLogs = new Set()
            logSearch = ''
            logFilter = 'all'
            activeLogTab = new Map()
        }
    });

    $effect(() => {
        if ($alertStore.type === 'error' && $alertStore.stackTrace && !translatedStackTrace && !stackTraceTranslationFailed && !isTranslating) {
            void loadTranslatedTrace();
        }
    });

    async function loadTranslatedTrace() {
        if (isTranslating || translatedStackTrace || stackTraceTranslationFailed || !$alertStore.stackTrace) return;
        isTranslating = true;
        try {
            const result = await translateStackTrace($alertStore.stackTrace);
            if (result.didTranslate) {
                translatedStackTrace = result.stackTrace;
            } else {
                stackTraceTranslationFailed = true;
            }
        } catch (e) {
            console.error("Failed to translate stack trace:", e);
            stackTraceTranslationFailed = true;
        } finally {
            isTranslating = false;
        }
    }

    const beautifyJSON = (data:string) =>{
        try {
            return JSON.stringify(JSON.parse(data), null, 2)
        } catch (error) {
            return data
        }
    }

    function getRequestLogsForViewer(): ViewerRequestLog[] {
        return getFetchLogs().map((log, index) => ({
            ...log,
            id: String(log.id ?? `request-log-${index}`) || `request-log-${index}`,
            body: String(log.body ?? ''),
            header: String(log.header ?? '{}'),
            response: String(log.response ?? ''),
            success: Boolean(log.success),
            date: String(log.date ?? ''),
            url: String(log.url ?? ''),
            method: String(log.method ?? 'POST') || 'POST',
            status: typeof log.status === 'number' ? log.status : undefined
        }))
    }

    function handleRequestLogsError(error: unknown) {
        void showLegacyRequestLogs(error)
    }
</script>

<svelte:window onmessage={async (e) => {
    if(e.origin.startsWith("https://sv.risuai.xyz") || e.origin.startsWith("https://nightly.sv.risuai.xyz") || e.origin.startsWith("http://127.0.0.1") || e.origin === window.location.origin){
        if(e.data.msg?.data?.vaild && $alertStore.type === 'login'){
            $alertStore = {
                type: 'none',
                msg: JSON.stringify(e.data.msg)
            }
        }
    }
}}></svelte:window>

{#if $alertStore.type !== 'none' &&  $alertStore.type !== 'toast' &&  $alertStore.type !== 'cardexport' && $alertStore.type !== 'branches' && $alertStore.type !== 'selectModule' && $alertStore.type !== 'pukmakkurit' && $alertStore.type !== 'requestlogs'}
    <div class="absolute w-full h-full z-50 bg-black/50 flex justify-center items-center" class:vis={ $alertStore.type === 'wait2'}>
        <div class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl  max-h-full overflow-y-auto">
            {#if $alertStore.type === 'error'}
                <h2 class="text-red-700 mt-0 mb-2 w-40 max-w-full">Error</h2>
            {:else if $alertStore.type === 'ask'}
                <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">Confirm</h2>
            {:else if $alertStore.type === 'pluginconfirm'}
                <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">Plugin Import</h2>
            {:else if $alertStore.type === 'selectChar'}
                <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">Select</h2>
            {:else if $alertStore.type === 'input'}
                <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">Input</h2>
            {/if}
            {#if $alertStore.type === 'markdown'}
                <div class="overflow-y-auto">
                    <span class="text-gray-300 chattext prose chattext2" class:prose-invert={$ColorSchemeTypeStore}>
                        {#await ParseMarkdown($alertStore.msg) then msg}
                            {@html msg}                        
                        {/await}
                    </span>
                </div>
            {:else if $alertStore.type === 'tos'}
                <!-- svelte-ignore a11y_missing_attribute -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->

                {#if import.meta.env.VITE_RISU_LEGAL_CONFIGURED}
                    <div class="text-textcolor">
                        You should accept
                        <a role="button" tabindex="0" class="text-green-600 hover:text-green-500 transition-colors duration-200 cursor-pointer" onclick={() => {
                            openURL('https://account.sionyw.com/terms')
                        }}>Terms of Service</a>

                        and

                        <a role="button" tabindex="0" class="text-green-600 hover:text-green-500 transition-colors duration-200 cursor-pointer" onclick={() => {
                            openURL('https://account.sionyw.com/privacy')
                        }}>Privacy Policy</a>

                        to continue
                    </div>

                    {#if localStorage.getItem('tos2') && Date.now() - new Date('2026-05-15').getTime() < 0}
                        <div class="text-gray-500 mt-4 text-sm">
                            You accepted previous version of Terms of Service and Privacy Policy.
                            Please review the updated documents by clicking the links above,
                            you can still continue using Risuai using original terms until {new Date('2026-05-15').toLocaleDateString()}.
                        </div>
                    {/if}
                {:else}
                    <div class="prose prose-invert">
                        <h2>Legal documents not configured</h2>
                        <p>
                            It looks like you are running a fork or a self-hosted instance.
                            If you are NOT running a self-hosted instance for private use from the original repository, you must:
                        </p>

                        <ul>
                            <li>Create your Terms of Service page and change the Terms of Service URL in the source code to your own.</li>
                            <li>Create your Privacy Policy page and change the Privacy Policy URL in the source code to your own.</li>
                            <li>Add Original Terms of Service and Privacy Policy alerts to parts that use Risuai services, such as login and API calls.</li>
                            <li>If you are sure you have configured everything correctly, you can proceed by setting VITE_RISU_LEGAL_CONFIGURED to TRUE in your environment variables.</li>
                        </ul>

                        <p>
                            If you are running a self-hosted instance for private use from the original repository, you can proceed by setting VITE_RISU_LEGAL_CONFIGURED to TRUE in your environment variables, without needing to do any of the above.
                        </p>
                    </div>
                {/if}
            {:else if $alertStore.type === 'pluginconfirm'}
                {@const parts = $alertStore.msg.split('\n\n')}
                {@const mainPart = parts[0]}
                {@const confirmMessage = parts[1]}
                {@const mainParts = mainPart.split('\n')}
                {@const pluginName = mainParts[0]}
                {@const warnings = mainParts.slice(1)}
                <div class="plugin-confirm-content">
                    <p class="plugin-name">{pluginName}</p>
                    {#if warnings.length > 0}
                        <ul class="warnings-list">
                            {#each warnings as warning}
                                <li class="warning-item">{warning}</li>
                            {/each}
                        </ul>
                    {/if}
                    <p class="confirm-message">{confirmMessage}</p>
                </div>
            {:else if $alertStore.type !== 'select' && $alertStore.type !== 'requestdata' && $alertStore.type !== 'addchar' && $alertStore.type !== 'hypaV2' && $alertStore.type !== 'chatOptions'}
                <span class="text-gray-300 whitespace-pre-wrap">{$alertStore.msg}</span>
                {#if $alertStore.submsg && $alertStore.type !== 'progress'}
                    <span class="text-gray-500 text-sm">{$alertStore.submsg}</span>
                {/if}

                {#if $alertStore.type === 'error' && $alertStore.stackTrace}
                    <div class="mt-4">
                        <Button styled="outlined" size="sm" onclick={() => showDetails = !showDetails}>
                            {showDetails ? language.hideErrorDetails : language.showErrorDetails}
                            {#if showDetails}
                                <XIcon class="inline ml-2" />
                            {:else}
                                <ChevronRightIcon class="inline ml-2" />
                            {/if}
                        </Button>
                        {#if showDetails}
                            <div class="stack-trace-wrap">
                                <button
                                    class="stack-trace-copy"
                                    onclick={() => copyToClipboard(stackTraceCodeBlock, 'stack-trace')}
                                    title={language.copy}
                                    aria-label={language.copy}
                                >
                                    {#if copiedKey === 'stack-trace'}
                                        <CheckIcon size={14} />
                                    {:else}
                                        <CopyIcon size={14} />
                                    {/if}
                                </button>
                                <pre class="stack-trace">{stackTraceCodeBlock}</pre>
                            </div>
                        {/if}
                    </div>
                {/if}
            {/if}
            {#if $alertStore.type === 'progress'}
                <div class="w-full min-w-64 md:min-w-138 h-2 bg-darkbg border border-darkborderc rounded-md mt-6">
                    <div class="h-full bg-linear-to-r from-blue-500 to-purple-800 saving-animation transition-[width]" style:width={$alertStore.submsg + '%'}></div>
                </div>
                <div class="w-full flex justify-center mt-6">
                    <span class="text-gray-500 text-sm">{$alertStore.submsg + '%'}</span>
                </div>
            {/if}

            {#if $alertStore.type === 'ask' || $alertStore.type === 'pluginconfirm'}
                <div class="flex gap-2 w-full">
                    <Button className="mt-4 grow" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: 'yes'
                        })
                    }}>YES</Button>
                    <Button className="mt-4 grow" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: 'no'
                        })
                    }}>NO</Button>
                </div>
            {:else if $alertStore.type === 'tos' && import.meta.env.VITE_RISU_LEGAL_CONFIGURED}
                <div class="flex gap-2 w-full">
                    <Button className="mt-4 grow" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: 'yes'
                        })
                    }}>Accept</Button>
                    <Button styled={'outlined'} className="mt-4 grow" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: 'no'
                        })
                    }}>Do not Accept</Button>
                </div>
            {:else if $alertStore.type === 'select'}
                {@const hasDisplay = $alertStore.msg.startsWith('__DISPLAY__')}
                {#if hasDisplay}
                    {@const parts = $alertStore.msg.substring(11).split('||')}
                    <div class="mb-4 text-textcolor">{parts[0]}</div>
                    {#each parts.slice(1) as n, i}
                        <Button className="mt-4" onclick={() => {
                            alertStore.set({
                                type: 'none',
                                msg: i.toString()
                            })
                        }}>{n}</Button>
                    {/each}
                {:else}
                    {@const parts = $alertStore.msg.split('||')}
                    {#each parts as n, i}
                        <Button className="mt-4" onclick={() => {
                            alertStore.set({
                                type: 'none',
                                msg: i.toString()
                            })
                        }}>{n}</Button>
                    {/each}
                {/if}
            {:else if $alertStore.type === 'error' || $alertStore.type === 'normal' || $alertStore.type === 'markdown'}
               <Button className="mt-4" onclick={() => {
                    alertStore.set({
                        type: 'none',
                        msg: ''
                    })
                }}>OK</Button>
            {:else if $alertStore.type === 'input'}
                <TextInput value={$alertStore.defaultValue} id="alert-input" autocomplete="off" marginTop list="alert-input-list" />
                <Button className="mt-4" onclick={() => {
                    alertStore.set({
                        type: 'none',
                        //@ts-expect-error 'value' doesn't exist on Element, but target is HTMLInputElement here
                        msg: document.querySelector('#alert-input')?.value
                    })
                }}>OK</Button>
                {#if $alertStore.datalist}
                    <datalist id="alert-input-list">
                        {#each $alertStore.datalist as item}
                            <option
                                value={item[0]}
                                label={item[1] ? item[1] : item[0]}
                            >{item[1] ? item[1] : item[0]}</option>
                        {/each}
                    </datalist>
                {/if}
            {:else if $alertStore.type === 'login'}
                <div class="fixed top-0 left-0 bg-black/50 w-full h-full flex justify-center items-center">
                    <iframe src={hubURL + '/hub/login'} title="login" class="w-full h-full">
                    </iframe>
                </div>
            {:else if $alertStore.type === 'selectChar'}
                <div class="flex w-full items-start flex-wrap gap-2 justify-start">
                    {#each DBState.db.characters as char, i}
                        {#if char.type !== 'group'}
                            {#if char.image}
                                {#await getCharImage(DBState.db.characters[i].image, 'css')}
                                    <BarIcon onClick={() => {
                                        alertStore.set({type: 'none',msg: char.chaId})
                                    }}>
                                        <User/>
                                    </BarIcon>
                                {:then im} 
                                    <BarIcon onClick={() => {
                                        alertStore.set({type: 'none',msg: char.chaId})
                                    }} additionalStyle={im} />
                                    
                                {/await}
                            {:else}
                                <BarIcon onClick={() => {
                                    alertStore.set({type: 'none',msg: char.chaId})
                                }}>
                                <User/>
                                </BarIcon>
                            {/if}
                        {/if}
                    {/each}
                </div>
            {:else if $alertStore.type === 'requestdata'}
                {#if aiLawApplies()}
                <div>
                    {language.generatedByAIDisclaimer}
                </div>
                {/if}
                <div class="flex flex-wrap gap-2">
                    <Button selected={generationInfoMenuIndex === 0} size="sm" onclick={() => {generationInfoMenuIndex = 0}}>
                        {language.tokens}
                    </Button>
                    <Button selected={generationInfoMenuIndex === 1} size="sm" onclick={() => {generationInfoMenuIndex = 1}}>
                        {language.metaData}
                    </Button>
                    <Button selected={generationInfoMenuIndex === 2} size="sm" onclick={() => {generationInfoMenuIndex = 2}}>
                        {language.log}
                    </Button>
                    <Button selected={generationInfoMenuIndex === 3} size="sm" onclick={() => {generationInfoMenuIndex = 3}}>
                        {language.prompt}
                    </Button>
                    <button class="ml-auto" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: ''
                        })
                    }}>✖</button>
                </div>
                {#if generationInfoMenuIndex === 0}
                    <div class="mt-4 flex justify-center w-full">
                        <div class="w-32 h-32 border-darkborderc border-4 rounded-lg" style:background={
                            `linear-gradient(0deg,
                            rgb(59,130,246) 0%,
                            rgb(59,130,246) ${($alertGenerationInfoStore.genInfo.inputTokens / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(34 197 94) ${($alertGenerationInfoStore.genInfo.inputTokens / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(34 197 94) ${(($alertGenerationInfoStore.genInfo.outputTokens + $alertGenerationInfoStore.genInfo.inputTokens) / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(156 163 175) ${(($alertGenerationInfoStore.genInfo.outputTokens + $alertGenerationInfoStore.genInfo.inputTokens) / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(156 163 175) 100%)`
                        }>

                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-y-2 gap-x-4 mt-4">
                        <span class="text-blue-500">{language.inputTokens}</span>
                        <span class="text-blue-500 justify-self-end">{$alertGenerationInfoStore.genInfo.inputTokens ?? '?'} {language.tokens}</span>
                        <span class="text-green-500">{language.outputTokens}</span>
                        <span class="text-green-500 justify-self-end">{$alertGenerationInfoStore.genInfo.outputTokens ?? '?'} {language.tokens}</span>
                        <span class="text-gray-400">{language.maxContextSize}</span>
                        <span class="text-gray-400 justify-self-end">{$alertGenerationInfoStore.genInfo.maxContext ?? '?'} {language.tokens}</span>
                    </div>
                    <span class="text-textcolor2 text-sm">{language.tokenWarning}</span>
                {/if}
                {#if generationInfoMenuIndex === 1}
                <div class="grid grid-cols-2 gap-y-2 gap-x-4 mt-4">
                    <span class="text-blue-500">Index</span>
                    <span class="text-blue-500 justify-self-end">{$alertGenerationInfoStore.idx}</span>
                    <span class="text-amber-500">Model</span>
                    <span class="text-amber-500 justify-self-end">{$alertGenerationInfoStore.genInfo.model}</span>
                    <span class="text-green-500">ID</span>
                    <span class="text-green-500 justify-self-end">{DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].chatId ?? "None"}</span>
                    <span class="text-red-500">GenID</span>
                    <span class="text-red-500 justify-self-end">{$alertGenerationInfoStore.genInfo.generationId}</span>
                    <span class="text-cyan-500">Saying</span>
                    <span class="text-cyan-500 justify-self-end">{DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].saying}</span>
                    <span class="text-purple-500">Size</span>
                    <span class="text-purple-500 justify-self-end">{JSON.stringify(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx]).length} Bytes</span>
                    <span class="text-yellow-500">Time</span>
                    <span class="text-yellow-500 justify-self-end">{(new Date(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].time ?? 0)).toLocaleString()}</span>
                    {#if $alertGenerationInfoStore.genInfo.stageTiming}
                        {@const stage1 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage1 ?? 0) / 1000).toFixed(1)))}
                        {@const stage2 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage2 ?? 0) / 1000).toFixed(1)))}
                        {@const stage3 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage3 ?? 0) / 1000).toFixed(1)))}
                        {@const stage4 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage4 ?? 0) / 1000).toFixed(1)))}
                        {@const totalRounded = (stage1 + stage2 + stage3 + stage4).toFixed(1)}
                        <span class="text-gray-400">Timing</span>
                        <span class="text-gray-400 justify-self-end">
                            <span style="color: #60a5fa;">{stage1}</span> + 
                            <span style="color: #db2777;">{stage2}</span> + 
                            <span style="color: #34d399;">{stage3}</span> + 
                            <span style="color: #8b5cf6;">{stage4}</span> = 
                            <span class="text-white font-bold">{totalRounded}s</span>
                        </span>
                    {/if}

                    <span class="text-green-500">Tokens</span>
                    {#await tokenize(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].data)}
                        <span class="text-green-500 justify-self-end">Loading</span>
                    {:then tokens} 
                        <span class="text-green-500 justify-self-end">{tokens}</span>
                    {/await}
                </div>
                {/if}
                {#if generationInfoMenuIndex === 2}
                    {#await getFetchData($alertStore.msg) then data} 
                        {#if !data}
                            <span class="text-gray-300 text-lg mt-2">{language.errors.requestLogRemoved}</span>
                            <span class="text-gray-500">{language.errors.requestLogRemovedDesc}</span>
                        {:else}
                            <h1 class="text-2xl font-bold my-4">URL</h1>
                            <code class="text-gray-300 border border-darkborderc p-2 rounded-md whitespace-pre-wrap">{data.url}</code>
                            <h1 class="text-2xl font-bold my-4">Request Body</h1>
                            <code class="text-gray-300 border border-darkborderc p-2 rounded-md whitespace-pre-wrap">{beautifyJSON(data.body)}</code>
                            <h1 class="text-2xl font-bold my-4">Response</h1>
                            <code class="text-gray-300 border border-darkborderc p-2 rounded-md whitespace-pre-wrap">{beautifyJSON(data.response)}</code>
                        {/if}
                    {/await}
                {/if}
                {#if generationInfoMenuIndex === 3}
                    {#if Object.keys(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo || {}).length === 0}
                        <div class="text-gray-300 text-lg mt-2">{language.promptInfoEmptyMessage}</div>
                    {:else}
                        <div class="grid grid-cols-2 gap-y-2 gap-x-4 mt-4">
                            <span class="text-blue-500">Preset Name</span>
                            <span class="text-blue-500 justify-self-end">{DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptName}</span>
                            <span class="text-purple-500">Toggles</span>
                            <div class="col-span-2 max-h-32 overflow-y-auto border border-stone-500 rounded-sm p-2 bg-gray-900">
                                {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptToggles.length === 0}
                                    <div class="text-gray-500 italic text-center py-4">{language.promptInfoEmptyToggle}</div>
                                {:else}
                                    <div class="grid grid-cols-2 gap-y-2 gap-x-4">
                                        {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptToggles as toggle}
                                        <span class="text-gray-200 truncate">{toggle.key}</span>
                                        <span class="text-gray-200 justify-self-end truncate">{toggle.value}</span>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                            <span class="text-red-500">Prompt Text</span>
                            <div class="col-span-2 max-h-80 overflow-y-auto border border-stone-500 rounded-sm p-4 bg-gray-900">
                                {#if !DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptText}
                                    <div class="text-gray-500 italic text-center py-4">{language.promptInfoEmptyText}</div>
                                {:else}
                                    {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptText as block}
                                        <div class="mb-2">
                                            <div class="font-bold text-gray-600">{block.role}</div>
                                            <pre class="whitespace-pre-wrap text-sm bg-stone-900 p-2 rounded-sm border border-stone-500">{block.content}</pre>
                                        </div>
                                    {/each}
                                {/if}
                            </div>
                        </div>
                    {/if}
                {/if}
            {:else if $alertStore.type === 'hypaV2'}
                <div class="flex flex-wrap gap-2 mb-4 max-w-full w-124">
                    <Button selected={generationInfoMenuIndex === 0} size="sm" onclick={() => {generationInfoMenuIndex = 0}}>
                        Chunks
                    </Button>
                    <Button selected={generationInfoMenuIndex === 1} size="sm" onclick={() => {generationInfoMenuIndex = 1}}>
                        Summarized
                    </Button>
                    <button class="ml-auto" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: ''
                        })
                    }}>✖</button>
                </div>
                {#if generationInfoMenuIndex === 0}
                    <div class="flex flex-col gap-2 w-full">
                        {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].hypaV2Data.chunks as chunk, i}
                            <TextAreaInput bind:value={chunk.text} />
                        {/each}

                        <!-- Adding non-bound chunk is not okay, change the user flow to edit existing ones. -->
                    </div>
                {:else}
                    {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].hypaV2Data.mainChunks as chunk, i} <!-- Summarized should be mainChunks, afaik. Be aware of that chunks are created with mainChunks, however this editing would not change related chunks. -->
                        <div class="flex flex-col p-2 rounded-md border-darkborderc border">
                            {#if i === 0}
                                <span class="text-green-500">Active</span>
                            {:else}
                                <span>Inactive</span>
                            {/if}
                            <TextAreaInput bind:value={chunk.text} />
                        </div>
                    {/each}
                {/if}
            {:else if $alertStore.type === 'addchar'}
                <div class="w-2xl flex flex-col max-w-full">

                    <button class="border-darkborderc border py-12 px-8 flex rounded-md hover:ring-2 justify-center items-center" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'importFromRealm'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span class="text-2xl font-bold">{language.importFromRealm}</span>
                            <span class="text-textcolor2">{language.importFromRealmDesc}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={((e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'importCharacter'
                        })
                    })}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.importCharacter}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'createfromScratch'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.createfromScratch}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'createGroup'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.createGroup}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'cancel'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.cancel}</span>
                        </div>
                    </button>
                </div>
            {:else if $alertStore.type === 'chatOptions'}
                <div class="w-2xl flex flex-col max-w-full">
                    <h1 class="text-xl mb-4 font-bold">
                        {language.chatOptions}
                    </h1>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: '0'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.createCopy}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: '1'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.bindPersona}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    {#if DBState.db.useExperimental}
                        <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={() => {
                            alertStore.set({
                                type: 'none',
                                msg: '2'
                            })
                        }}>
                            <div class="flex flex-col justify-start items-start">
                                <span>{language.createMultiuserRoom} <Help key="experimental"/></span>
                            </div>
                            <div class="ml-9 float-right flex-1 flex justify-end">
                                <ChevronRightIcon />
                            </div>
                        </button>
                    {/if}
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: 'cancel'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.cancel}</span>
                        </div>
                    </button>
                </div>
            {/if}
        </div>
    </div>

{:else if $alertStore.type === 'cardexport'}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div  class="fixed top-0 left-0 h-full w-full bg-black/50 flex flex-col z-50 items-center justify-center" role="button" tabindex="0" onclick={close}>
        <div class="bg-darkbg rounded-md p-4 max-w-full flex flex-col w-2xl" role="button" tabindex="0" onclick={(e) => {
            e.stopPropagation()
        }}>
            <h1 class="font-bold text-2xl w-full">
                <span>
                    {language.shareExport}
                </span>
                <button class="float-right text-textcolor2 hover:text-green-500" onclick={() => {
                    alertStore.set({
                        type: 'none',
                        msg: JSON.stringify({
                            type: 'cancel',
                            type2: cardExportType2
                        })
                    })
                }}>
                    <XIcon />
                </button>
            </h1>
            <span class="text-textcolor mt-4">{language.type}</span>
            {#if cardExportType === ''}
                {#if $alertStore.submsg === 'module'}
                    <span class="text-textcolor2 text-sm">{language.risuMDesc}</span>
                {:else if $alertStore.submsg === 'preset'}
                    <span class="text-textcolor2 text-sm">{language.risupresetDesc}</span>
                    {#if cardExportType2 === 'preset' && (DBState.db.botPresets[DBState.db.botPresetsId].image || DBState.db.botPresets[DBState.db.botPresetsId].regex?.length > 0)}
                        <span class="text-red-500 text-sm">Use RisuRealm to share the preset. Preset with image or regexes cannot be exported for now.</span>
                    {/if}
                {:else}
                    <span class="text-textcolor2 text-sm">{language.ccv3Desc}</span>
                    {#if cardExportType2 !== 'charx' && cardExportType2 !== 'charxJpeg' && isCharacterHasAssets(DBState.db.characters[$selectedCharID])}
                        <span class="text-red-500 text-sm">{language.notCharxWarn}</span>
                    {/if}
                {/if}
            {:else if cardExportType === 'json'}
                <span class="text-textcolor2 text-sm">{language.jsonDesc}</span>
            {:else if cardExportType === 'ccv2'}
                <span class="text-textcolor2 text-sm">{language.ccv2Desc}</span>
                <span class="text-red-500 text-sm">{language.v2Warning}</span>
            {:else}
                <span class="text-textcolor2 text-sm">{language.realmDesc}</span>
            {/if}
            <div class="flex items-center flex-wrap mt-2">
                {#if $alertStore.submsg === 'preset'}
                    <button class="bg-bgcolor px-2 py-4 rounded-lg flex-1" class:ring-1={cardExportType === 'realm'} onclick={() => {cardExportType = 'realm'}}>RisuRealm</button>
                    <button class="bg-bgcolor px-2 py-4 rounded-lg ml-2 flex-1" class:ring-1={cardExportType === ''} onclick={() => {cardExportType = ''}}>Risupreset</button>
                {:else if $alertStore.submsg === 'module'}
                    <button class="bg-bgcolor px-2 py-4 rounded-lg ml-2 flex-1" class:ring-1={cardExportType === 'realm'} onclick={() => {cardExportType = 'realm'}}>RisuRealm</button>
                    <button class="bg-bgcolor px-2 py-4 rounded-lg flex-1" class:ring-1={cardExportType === ''} onclick={() => {cardExportType = ''}}>RisuM</button>
                {:else}
                    <button class="bg-bgcolor px-2 py-4 rounded-lg flex-1" class:ring-1={cardExportType === 'realm'} onclick={() => {cardExportType = 'realm'}}>RisuRealm</button>
                    <button class="bg-bgcolor px-2 py-4 rounded-lg ml-2 flex-1" class:ring-1={cardExportType === ''} onclick={() => {
                        cardExportType = ''
                        cardExportType2 = 'charxJpeg'
                    }}>Character Card V3</button>
                    <button class="bg-bgcolor px-2 py-4 rounded-lg ml-2 flex-1" class:ring-1={cardExportType === 'ccv2'} onclick={() => {cardExportType = 'ccv2'}}>Character Card V2</button>
                {/if}
            </div>
            {#if $alertStore.submsg === '' && cardExportType === ''}
                <span class="text-textcolor mt-4">{language.format}</span>
                <SelectInput bind:value={cardExportType2} className="mt-2">
                    <OptionInput value="charx">CHARX</OptionInput>
                    <OptionInput value="charxJpeg">CHARX-JPEG</OptionInput>
                    <OptionInput value="">PNG</OptionInput>
                    <OptionInput value="json">JSON</OptionInput>
                </SelectInput>
            {/if}
            <Button className="mt-4" onclick={() => {
                alertStore.set({
                    type: 'none',
                    msg: JSON.stringify({
                        type: cardExportType,
                        type2: cardExportType2
                    })
                })
            }}>{cardExportType === 'realm' ? language.shareCloud : language.export}</Button>
        </div>
    </div>

{:else if $alertStore.type === 'toast'}
    <div class="toast-anime absolute right-0 bottom-0 bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl  max-h-11/12 overflow-y-auto z-50 text-textcolor"
        onanimationend={() => {
            alertStore.set({
                type: 'none',
                msg: ''
            })
        }}
    >{$alertStore.msg}</div>
{:else if $alertStore.type === 'selectModule'}
    <ModuleChatMenu alertMode close={(d) => {
        alertStore.set({
            type: 'none',
            msg: d
        })
    }} />
{:else if $alertStore.type === 'pukmakkurit'}
    <!-- Log Generator by dootaang, GPL3 -->
    <!-- Svelte, Typescript version by Kwaroran -->
    
    <div class="absolute w-full h-full z-50 bg-black/50 flex justify-center items-center">
        <div class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl  max-h-full overflow-y-auto">
            <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.preview}</h2>

        </div>
    </div>
{:else if $alertStore.type === 'branches'}
    <div class="absolute w-full h-full z-50 bg-black/80 flex justify-center items-center overflow-x-auto overflow-y-auto">
        {#if branchHover !== null}
            <div class="z-30 whitespace-pre-wrap p-4 text-textcolor bg-darkbg border-darkborderc border rounded-md absolute" style="top: {branchHover.y * 80 + 24}px; left: {(branchHover.x + 1) * 80 + 24}px">
                {branchHover.content}
            </div>
        {/if}

        <div class="x-50 right-2 top-2 absolute">
            <button class="bg-darkbg border-darkborderc border p-2 rounded-md" onclick={() => {
                alertStore.set({
                    type: 'none',
                    msg: ''
                })
            }}>
                <XIcon />
            </button>
        </div>

        {#each getChatBranches() as obj}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div
                role="table"
                class="peer w-12 h-12 z-20 bg-bgcolor border border-darkborderc rounded-full flex justify-center items-center overflow-y-auto absolute"
                style="top: {obj.y * 80 + 24}px; left: {obj.x * 80 + 24}px"
                onmouseenter={() => {
                    if(branchHover === null){
                        const char = getCurrentCharacter()
                        branchHover = {
                            x: obj.x,
                            y: obj.y,
                            content: char.chats[obj.chatId].message[obj.y - 1].data
                        }
                    }
                }}
                onclick={() => {
                    if(branchHover === null){
                        const char = getCurrentCharacter()
                        branchHover = {
                            x: obj.x,
                            y: obj.y,
                            content: char.chats[obj.chatId].message[obj.y - 1].data
                        }
                    }
                }}
                onmouseleave={() => {
                    branchHover = null
                }}
            >
                
            </div>
            {#if obj.connectX === obj.x}
                {#if obj.multiChild}
                    <div class="w-0 h-20 border-x border-x-red-500 absolute" style="top: {(obj.y-1) * 80 + 24}px; left: {obj.x * 80 + 45}px">

                    </div>
                {:else}
                    <div class="w-0 h-20 border-x border-x-blue-500 absolute" style="top: {(obj.y-1) * 80 + 24}px; left: {obj.x * 80 + 45}px">

                    </div>
                {/if}
            {:else if obj.connectX !== -1}
                <div class="w-0 h-10 border-x border-x-red-500 absolute" style="top: {(obj.y) * 80}px; left: {obj.x * 80 + 45}px">

                </div>
                <div class="h-0 border-y border-y-red-500 absolute" style="top: {(obj.y) * 80}px; left: {obj.connectX * 80 + 46}px" style:width={Math.abs((obj.x - obj.connectX) * 80) + 'px'}>

                </div>
            {/if}
        {/each}
    </div>
{:else if $alertStore.type === 'requestlogs'}
    <svelte:boundary onerror={handleRequestLogsError}>
        {@const logs = getRequestLogsForViewer()}
        {@const filteredLogs = logs.filter(log => {
            const matchFilter = logFilter === 'all' || (logFilter === 'success' ? log.success : !log.success)
            const matchSearch = logSearch === '' || log.url.toLowerCase().includes(logSearch.toLowerCase())
            return matchFilter && matchSearch
        })}
        {@const allFilteredExpanded = filteredLogs.length > 0 && filteredLogs.every((log) => expandedLogs.has(log.id))}
        <div class="fixed inset-0 z-50 bg-black/80 flex justify-center items-start overflow-y-auto p-4">
            <div class="bg-darkbg rounded-lg overflow-hidden w-full max-w-4xl my-4 flex flex-col max-h-[90vh]">
                <!-- Header -->
                <div class="flex items-center justify-between px-5 py-4 border-b border-darkborderc sticky top-0 bg-darkbg z-10">
                    <div class="flex items-center gap-3">
                        <h1 class="text-lg font-bold text-textcolor">{language.ShowLog}</h1>
                        <span class="text-xs text-textcolor2 bg-bgcolor px-2 py-0.5 rounded-full">{logs.length}</span>
                    </div>
                    <button class="text-textcolor2 hover:text-textcolor p-1" onclick={() => {
                        alertStore.set({ type: 'none', msg: '' })
                    }}>
                        <XIcon size={20} />
                    </button>
                </div>
                <!-- Toolbar -->
                <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 px-5 py-3 border-b border-darkborderc bg-darkbg">
                    <div class="flex-1 relative">
                        <input
                            type="text"
                            placeholder={language.filterByURL}
                            bind:value={logSearch}
                            class="w-full bg-bgcolor border border-darkborderc rounded text-sm text-textcolor px-3 py-1.5 pr-8 focus:outline-none focus:border-blue-500 placeholder:text-textcolor2"
                        />
                        {#if logSearch}
                            <button
                                class="absolute right-2 top-1/2 -translate-y-1/2 text-textcolor2 hover:text-textcolor"
                                onclick={() => { logSearch = '' }}
                            >
                                <XIcon size={14} />
                            </button>
                        {/if}
                    </div>
                    <div class="flex items-center gap-2 justify-between">
                        <div class="flex rounded overflow-hidden border border-darkborderc text-xs flex-1 sm:flex-initial">
                            {#each (['all', 'success', 'error'] as const) as f}
                                <button
                                    class="px-3 py-1.5 transition-colors flex-1 sm:flex-initial {logFilter === f ? 'bg-blue-600 text-white' : 'bg-bgcolor text-textcolor2 hover:text-textcolor'}"
                                    onclick={() => { logFilter = f }}
                                >{f === 'all' ? language.allLogs : f === 'success' ? language.successLogs : language.errorLogs}</button>
                            {/each}
                        </div>
                        <Button size="sm" onclick={() => {
                            if(allFilteredExpanded) {
                                expandedLogs = new Set()
                            } else {
                                expandedLogs = new Set(filteredLogs.map((log) => log.id))
                            }
                        }}>
                            {allFilteredExpanded ? language.collapseAll : language.expandAll}
                        </Button>
                    </div>
                </div>
                <!-- Log list -->
                <div class="flex-1 overflow-y-auto request-log-container">
                    {#if filteredLogs.length === 0}
                        <div class="text-textcolor2 text-center py-12 text-sm">{language.noRequestLogs}</div>
                    {:else}
                        <div class="flex flex-col gap-2 p-2">
                            {#each filteredLogs as log (log.id)}
                                {@const isExpanded = expandedLogs.has(log.id)}
                                {@const method = log.method ?? 'POST'}
                                {@const statusCode = log.status}
                                {@const methodColor = method === 'GET' ? 'bg-green-700' : method === 'DELETE' ? 'bg-red-700' : method === 'PUT' ? 'bg-orange-600' : method === 'PATCH' ? 'bg-yellow-600' : 'bg-blue-600'}
                                {@const statusColor = statusCode === undefined ? (log.success ? 'bg-green-700' : 'bg-red-700') : statusCode >= 500 ? 'bg-red-700' : statusCode >= 400 ? 'bg-yellow-600' : 'bg-green-700'}
                                {@const accentColor = log.success ? 'bg-green-500' : 'bg-red-500'}
                                {@const activeTab = activeLogTab.get(log.id) ?? 'request'}
                                <div class="overflow-hidden rounded-lg border border-darkborderc bg-darkbg/60 transition-colors hover:bg-bgcolor/20">
                                    <div class="flex items-stretch">
                                        <div class="flex shrink-0 items-stretch">
                                            <div class="w-1 {accentColor}"></div>
                                        </div>
                                        <div class="min-w-0 flex-1">
                                    <!-- Row header -->
                                    <button
                                        class="w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 text-left"
                                        onclick={() => {
                                            const newSet = new Set(expandedLogs)
                                            if(isExpanded) {
                                                newSet.delete(log.id)
                                            } else {
                                                newSet.add(log.id)
                                            }
                                            expandedLogs = newSet
                                        }}
                                    >
                                        <div class="flex items-center gap-3 flex-1 min-w-0">
                                            <span class="flex shrink-0 items-center justify-center {methodColor} text-white text-sm font-bold font-mono px-3 py-1 rounded min-w-[64px] text-center uppercase leading-none">
                                                <span class="translate-y-[1px]">{method}</span>
                                            </span>
                                            <span class="flex-1 text-textcolor text-sm font-mono truncate text-left" title={log.url}>
                                                {log.url}
                                            </span>
                                            <span class="flex shrink-0 items-center justify-center {statusColor} text-white text-sm font-bold font-mono px-2 py-1 rounded min-w-[52px] text-center uppercase leading-none">
                                                <span class="translate-y-[1px]">{statusCode ?? (log.success ? '200' : 'ERR')}</span>
                                            </span>
                                        </div>
                                        <div class="flex items-center justify-between sm:justify-end gap-3 shrink-0 border-t border-darkborderc/20 pt-2 sm:border-t-0 sm:pt-0">
                                            <span class="text-textcolor2 text-xs font-mono">{log.date}</span>
                                            <span class="shrink-0 text-textcolor2">
                                                {#if isExpanded}<ChevronUpIcon size={16} />{:else}<ChevronDownIcon size={16} />{/if}
                                            </span>
                                        </div>
                                    </button>
                                    <!-- Expanded detail -->
                                    {#if isExpanded}
                                        <div class="border-t border-darkborderc">
                                            <!-- Tabs -->
                                            <div class="flex border-b border-darkborderc bg-bgcolor/30">
                                                {#each (['request', 'response'] as const) as tab}
                                                    <button
                                                        class="px-5 py-2 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 -mb-px {activeTab === tab ? 'border-blue-500 text-blue-400' : 'border-transparent text-textcolor2 hover:text-textcolor'}"
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            const m = new Map(activeLogTab)
                                                            m.set(log.id, tab)
                                                            activeLogTab = m
                                                        }}
                                                    >{tab === 'request' ? language.requestTab : language.responseTab}</button>
                                                {/each}
                                            </div>
                                            <!-- Tab content -->
                                            <div class="p-4 space-y-4">
                                                {#if activeTab === 'request'}
                                                    <!-- URL -->
                                                    <div>
                                                        <div class="flex items-center justify-between mb-1.5">
                                                            <span class="text-xs font-semibold uppercase tracking-wider text-textcolor2">{language.urlLabel}</span>
                                                            <button
                                                                class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${log.id}-url` ? 'text-green-400' : 'text-textcolor2 hover:text-textcolor'}"
                                                                onclick={(e) => { e.stopPropagation(); copyToClipboard(log.url, `${log.id}-url`) }}
                                                            >
                                                                {#if copiedKey === `${log.id}-url`}<CheckIcon size={12} />{:else}<CopyIcon size={12} />{/if}
                                                            </button>
                                                        </div>
                                                        <pre class="request-log-code text-sm break-all">{log.url}</pre>
                                                    </div>
                                                    <!-- Headers -->
                                                    <div>
                                                        <div class="flex items-center justify-between mb-1.5">
                                                            <span class="text-xs font-semibold uppercase tracking-wider text-textcolor2">{language.headersLabel}</span>
                                                            <button
                                                                class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${log.id}-header` ? 'text-green-400' : 'text-textcolor2 hover:text-textcolor'}"
                                                                onclick={(e) => { e.stopPropagation(); copyToClipboard(log.header, `${log.id}-header`) }}
                                                            >
                                                                {#if copiedKey === `${log.id}-header`}<CheckIcon size={12} />{:else}<CopyIcon size={12} />{/if}
                                                            </button>
                                                        </div>
                                                        <pre class="request-log-code hljs max-h-40">{@html highlightJson(log.header)}</pre>
                                                    </div>
                                                    <!-- Body -->
                                                    <div>
                                                        <div class="flex items-center justify-between mb-1.5">
                                                            <span class="text-xs font-semibold uppercase tracking-wider text-textcolor2">{language.requestBodyLabel}</span>
                                                            {#if log.body}
                                                                <button
                                                                    class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${log.id}-body` ? 'text-green-400' : 'text-textcolor2 hover:text-textcolor'}"
                                                                    onclick={(e) => { e.stopPropagation(); copyToClipboard(log.body, `${log.id}-body`) }}
                                                                >
                                                                    {#if copiedKey === `${log.id}-body`}<CheckIcon size={12} />{:else}<CopyIcon size={12} />{/if}
                                                                </button>
                                                            {/if}
                                                        </div>
                                                        {#if log.body}
                                                            <pre class="request-log-code hljs">{@html highlightJson(log.body)}</pre>
                                                        {:else}
                                                            <p class="text-xs text-textcolor2 italic px-1">{language.noBody}</p>
                                                        {/if}
                                                    </div>
                                                {:else}
                                                    <!-- Response -->
                                                    <div>
                                                        <div class="flex items-center justify-between mb-1.5">
                                                            <div class="flex items-center gap-2">
                                                                <span class="text-xs font-semibold uppercase tracking-wider text-textcolor2">{language.responseBodyLabel}</span>
                                                                {#if statusCode}
                                                                    <span class="flex shrink-0 items-center justify-center {statusColor} text-white text-[11px] font-bold font-mono px-1 py-0.5 rounded text-center uppercase leading-none">
                                                                        <span class="translate-y-[0.5px]">{statusCode}</span>
                                                                    </span>
                                                                {/if}
                                                            </div>
                                                            <button
                                                                class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${log.id}-response` ? 'text-green-400' : 'text-textcolor2 hover:text-textcolor'}"
                                                                onclick={(e) => { e.stopPropagation(); copyToClipboard(log.response, `${log.id}-response`) }}
                                                            >
                                                                {#if copiedKey === `${log.id}-response`}<CheckIcon size={12} />{:else}<CopyIcon size={12} />{/if}
                                                            </button>
                                                        </div>
                                                        <pre class="request-log-code hljs max-h-80">{@html highlightJson(log.response)}</pre>
                                                    </div>
                                                {/if}
                                            </div>
                                        </div>
                                    {/if}
                                        </div>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
        </div>
        {#snippet failed()}
            <div class="hidden" aria-hidden="true"></div>
        {/snippet}
    </svelte:boundary>
{/if}

<style>
    .plugin-confirm-content .plugin-name {
        font-size: 1.25rem;
        font-weight: bold;
        color: white;
    }
    .plugin-confirm-content .warnings-list {
        list-style-type: disc;
        list-style-position: inside;
        margin-top: 0.5rem;
        margin-bottom: 0.5rem;
        padding-left: 1rem;
        color: #f87171; /* red-400 */
    }
    .plugin-confirm-content .warning-item {
        margin-bottom: 0.25rem;
    }
    .plugin-confirm-content .confirm-message {
        margin-top: 1rem;
        color: #d1d5db; /* gray-300 */
    }
    .break-any{
        word-break: normal;
        overflow-wrap: anywhere;
    }
    @keyframes toastAnime {
        0% {
            opacity: 0;
        }
        50% {
            opacity: 1;
        }
        100% {
            opacity: 0;
        }
    }

    .toast-anime {
        animation: toastAnime 1s ease-out;
    }

    .vis{
        opacity: 1 !important;
        --tw-bg-opacity: 1 !important;
    }

    .stack-trace-wrap {
        position: relative;
        margin-top: 0.5rem;
    }

    .stack-trace {
        background-color: var(--risu-theme-bgcolor);
        color: var(--risu-theme-textcolor2);
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: 0.25rem;
        padding: 0.75rem 2.75rem 0.75rem 0.75rem;
        font-family: monospace;
        font-size: 0.75rem;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 200px;
        overflow-y: auto;
    }

    .stack-trace-copy {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: 0.375rem;
        background-color: var(--risu-theme-darkbg);
        color: var(--risu-theme-textcolor2);
        transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
    }

    .stack-trace-copy:hover {
        background-color: var(--risu-theme-bgcolor);
        color: var(--risu-theme-textcolor);
    }

    .request-log-container, .request-log-code {
        scrollbar-width: thin;
        scrollbar-color: rgba(128, 128, 128, 0.4) transparent;
    }

    .request-log-container::-webkit-scrollbar, .request-log-code::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }

    .request-log-container::-webkit-scrollbar-track, .request-log-code::-webkit-scrollbar-track {
        background: transparent;
    }

    .request-log-container::-webkit-scrollbar-thumb, .request-log-code::-webkit-scrollbar-thumb {
        background: transparent;
        border-radius: 10px;
    }

    .request-log-container:hover::-webkit-scrollbar-thumb, .request-log-code:hover::-webkit-scrollbar-thumb {
        background: rgba(128, 128, 128, 0.4);
    }

    .request-log-container::-webkit-scrollbar-thumb:hover, .request-log-code::-webkit-scrollbar-thumb:hover {
        background: rgba(128, 128, 128, 0.6);
    }

    .request-log-code {
        background-color: var(--risu-theme-bgcolor);
        color: var(--risu-theme-textcolor);
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: 0.375rem;
        padding: 0.75rem;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 0.75rem;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 16rem;
        overflow: auto;
    }
</style>
