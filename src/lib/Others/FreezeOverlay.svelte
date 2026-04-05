<script lang="ts">
    import { watchdogState, triggerAbort, dismissFreezeNotification } from 'src/ts/watchdog/watchdogManager.svelte'
    import { language } from 'src/lang'
    import { doingChat } from 'src/ts/process/index.svelte'
    import { AlertTriangleIcon, XIcon, OctagonXIcon, CheckCircleIcon } from '@lucide/svelte'

    let visible = $derived(watchdogState.frozen || watchdogState.recovered)
    let isDoingChat = $derived($doingChat)

    // Auto-dismiss recovered notification after 8 seconds
    $effect(() => {
        if (watchdogState.recovered && !watchdogState.frozen) {
            const timer = setTimeout(() => {
                dismissFreezeNotification()
            }, 8000)
            return () => clearTimeout(timer)
        }
    })

    function getStageName(stage: number): string {
        const stages = language.freezeDetection?.stages
        if (!stages) return `Stage ${stage}`
        switch (stage) {
            case -1: return stages.idle
            case 0: return stages.init
            case 1: return stages.promptBuilding
            case 2: return stages.memoryProcessing
            case 3: return stages.apiRequest
            case 4: return stages.postProcessing
            default: return `Stage ${stage}`
        }
    }

    function formatDuration(ms: number): string {
        return (ms / 1000).toFixed(1)
    }

    function handleAbort() {
        triggerAbort()
    }

    function handleDismiss() {
        dismissFreezeNotification()
    }
</script>

{#if visible}
    <div class="fixed inset-0 z-[60] flex items-start justify-center pt-8 pointer-events-none">
        <div 
            class="pointer-events-auto max-w-md w-full mx-4 rounded-xl shadow-2xl border overflow-hidden transition-all duration-300 {watchdogState.frozen ? 'bg-red-950 border-red-800' : 'bg-darkbg border-green-800'}"
        >
            <!-- Header -->
            <div 
                class="px-4 py-3 flex items-center gap-3 {watchdogState.frozen ? 'bg-red-900/50' : 'bg-green-900/30'}"
            >
                {#if watchdogState.frozen}
                    <div class="shrink-0">
                        <AlertTriangleIcon size={20} class="text-red-400 animate-pulse" />
                    </div>
                    <h3 class="text-red-200 font-semibold text-sm flex-1">
                        {language.freezeDetection?.title ?? 'Main Thread Freeze Detected'}
                    </h3>
                {:else}
                    <div class="shrink-0">
                        <CheckCircleIcon size={20} class="text-green-400" />
                    </div>
                    <h3 class="text-green-200 font-semibold text-sm flex-1">
                        {language.freezeDetection?.recovered ?? 'Recovered'}
                    </h3>
                    <button 
                        class="text-gray-400 hover:text-gray-200 transition-colors p-1 rounded"
                        onclick={handleDismiss}
                    >
                        <XIcon size={16} />
                    </button>
                {/if}
            </div>

            <!-- Body -->
            <div class="px-4 py-3 space-y-2">
                {#if watchdogState.frozen}
                    <p class="text-red-300/80 text-xs">
                        {language.freezeDetection?.description ?? 'The application became unresponsive.'}
                    </p>
                    
                    <div class="flex items-center justify-between text-xs">
                        <span class="text-red-400/60">
                            {language.freezeDetection?.stage ?? 'Current Stage'}
                        </span>
                        <span class="text-red-200 font-mono">
                            {getStageName(watchdogState.stage)}
                        </span>
                    </div>

                    <div class="flex items-center justify-between text-xs">
                        <span class="text-red-400/60">
                            {language.freezeDetection?.duration ?? 'Frozen for'}
                        </span>
                        <span class="text-red-200 font-mono tabular-nums">
                            {formatDuration(watchdogState.freezeDuration)}{language.freezeDetection?.seconds ?? 's'}
                        </span>
                    </div>

                    <!-- Progress bar showing freeze severity -->
                    <div class="w-full h-1 bg-red-900/50 rounded-full overflow-hidden">
                        <div 
                            class="h-full bg-red-500 transition-all duration-1000 rounded-full"
                            style="width: {Math.min((watchdogState.freezeDuration / 30000) * 100, 100)}%"
                        ></div>
                    </div>

                    {#if isDoingChat}
                        <button 
                            class="w-full mt-2 px-3 py-2 bg-red-800 hover:bg-red-700 text-red-100 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                            onclick={handleAbort}
                        >
                            <OctagonXIcon size={14} />
                            {language.freezeDetection?.abort ?? 'Abort Current Operation'}
                        </button>
                    {/if}
                {:else}
                    <p class="text-gray-400 text-xs">
                        {language.freezeDetection?.recoveredDescription ?? 'The application has recovered.'}
                    </p>
                    
                    <div class="flex items-center justify-between text-xs">
                        <span class="text-gray-500">
                            {language.freezeDetection?.frozenAt ?? 'Froze during'}
                        </span>
                        <span class="text-gray-300 font-mono">
                            {getStageName(watchdogState.stage)}
                        </span>
                    </div>

                    <div class="flex items-center justify-between text-xs">
                        <span class="text-gray-500">
                            {language.freezeDetection?.duration ?? 'Duration'}
                        </span>
                        <span class="text-gray-300 font-mono tabular-nums">
                            {formatDuration(watchdogState.lastFreezeDuration)}{language.freezeDetection?.seconds ?? 's'}
                        </span>
                    </div>

                    <button 
                        class="w-full mt-1 px-3 py-1.5 bg-darkbg hover:bg-gray-700 border border-darkborderc text-gray-300 text-xs rounded-lg transition-colors"
                        onclick={handleDismiss}
                    >
                        {language.freezeDetection?.dismiss ?? 'Dismiss'}
                    </button>
                {/if}
            </div>
        </div>
    </div>
{/if}
