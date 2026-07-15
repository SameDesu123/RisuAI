<script lang="ts">
    import { CalendarDaysIcon, ChartNoAxesCombinedIcon, CoinsIcon, PlusIcon, TrashIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import {
        deleteApiUsageCustomPricing,
        getApiUsageDateKey,
        getApiUsageSummary,
        setApiUsageCustomPricing,
        type ApiUsageDay,
        type ApiUsageModelStats,
        type ApiUsageSummaryRange,
    } from "src/ts/apiUsage";
    import { DBState } from "src/ts/stores.svelte";

    interface HeatmapDay {
        date: Date
        key: string
        stats?: ApiUsageDay
        level: number
        future: boolean
    }

    const today = new Date()
    today.setHours(12, 0, 0, 0)
    let selectedDate = $state(getApiUsageDateKey(today))
    let summaryRange = $state<ApiUsageSummaryRange>(365)
    let customPricingModel = $state('')
    let customInputPrice = $state<number | undefined>(undefined)
    let customOutputPrice = $state<number | undefined>(undefined)

    const summaryRangeOptions = $derived([
        { value: 7 as const, label: language.apiUsageStatistics.last7Days },
        { value: 30 as const, label: language.apiUsageStatistics.last30Days },
        { value: 90 as const, label: language.apiUsageStatistics.last90Days },
        { value: 365 as const, label: language.apiUsageStatistics.last365Days },
        { value: 'all' as const, label: language.apiUsageStatistics.allTime },
    ])

    const heatmapDays = $derived.by(() => {
        const start = new Date(today)
        start.setDate(today.getDate() - today.getDay() - (52 * 7))

        const rawDays: Omit<HeatmapDay, 'level'>[] = []
        let maxTokens = 0
        for(let index = 0; index < 53 * 7; index++){
            const date = new Date(start)
            date.setDate(start.getDate() + index)
            const key = getApiUsageDateKey(date)
            const stats = DBState.db.apiUsage.daily[key]
            const tokens = getTotalTokens(stats)
            maxTokens = Math.max(maxTokens, tokens)
            rawDays.push({ date, key, stats, future: date > today })
        }

        return rawDays.map((day) => {
            const tokens = getTotalTokens(day.stats)
            const level = tokens === 0 || maxTokens === 0
                ? 0
                : Math.max(1, Math.ceil((Math.log(tokens + 1) / Math.log(maxTokens + 1)) * 4))
            return { ...day, level }
        })
    })

    const summaryTotals = $derived(getApiUsageSummary(DBState.db.apiUsage, summaryRange, today))

    const customPricingEntries = $derived(
        Object.entries(DBState.db.apiUsage.customPricing).sort(([a], [b]) => a.localeCompare(b)),
    )

    const recordedModels = $derived.by(() => {
        const models = new Set<string>()
        for (const day of Object.values(DBState.db.apiUsage.daily)) {
            for (const model of Object.keys(day.models)) models.add(model)
        }
        return [...models].sort((a, b) => a.localeCompare(b))
    })

    const canSaveCustomPricing = $derived(
        customPricingModel.trim().length > 0
        && typeof customInputPrice === 'number'
        && Number.isFinite(customInputPrice)
        && customInputPrice >= 0
        && typeof customOutputPrice === 'number'
        && Number.isFinite(customOutputPrice)
        && customOutputPrice >= 0,
    )

    const selectedStats = $derived(DBState.db.apiUsage.daily[selectedDate])

    function getTotalTokens(stats?: Pick<ApiUsageDay, 'inputTokens'|'outputTokens'>) {
        return (stats?.inputTokens ?? 0) + (stats?.outputTokens ?? 0)
    }

    function getRequestStatusSummary(stats: ApiUsageModelStats) {
        return `${language.apiUsageStatistics.succeeded} ${formatNumber(stats.successRequestCount)} · ${language.apiUsageStatistics.failed} ${formatNumber(stats.failedRequestCount)} · ${language.apiUsageStatistics.cancelled} ${formatNumber(stats.cancelledRequestCount)}`
    }

    function getRequestModeSummary(stats: ApiUsageModelStats) {
        const auxiliaryRequests = stats.requestCountsByMode.submodel
            + stats.requestCountsByMode.memory
            + stats.requestCountsByMode.emotion
            + stats.requestCountsByMode.otherAx
        return `${language.apiUsageStatistics.chatRequests} ${formatNumber(stats.requestCountsByMode.model)} · ${language.apiUsageStatistics.translationRequests} ${formatNumber(stats.requestCountsByMode.translate)} · ${language.apiUsageStatistics.auxiliaryRequests} ${formatNumber(auxiliaryRequests)}`
    }

    function formatNumber(value: number) {
        return new Intl.NumberFormat().format(value)
    }

    function formatCost(value: number) {
        const fractionDigits = value > 0 && value < 0.01 ? 4 : 2
        return `$${value.toFixed(fractionDigits)}`
    }

    function formatDate(date: Date) {
        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        }).format(date)
    }

    function getHeatmapClass(day: HeatmapDay) {
        if(day.future) return 'bg-textcolor/3'
        if(day.level === 0) return 'bg-textcolor/5'
        if(day.level === 1) return 'bg-selected/30'
        if(day.level === 2) return 'bg-selected/50'
        if(day.level === 3) return 'bg-selected/70'
        return 'bg-selected'
    }

    function getDayLabel(day: HeatmapDay) {
        const stats = day.stats
        return `${formatDate(day.date)}: ${formatNumber(getTotalTokens(stats))} ${language.apiUsageStatistics.tokens}, ${formatNumber(stats?.requestCount ?? 0)} ${language.apiUsageStatistics.requests}`
    }

    function saveCustomPricing(event: SubmitEvent) {
        event.preventDefault()
        if (!canSaveCustomPricing || customInputPrice === undefined || customOutputPrice === undefined) return
        if (setApiUsageCustomPricing(customPricingModel, customInputPrice, customOutputPrice)) {
            customPricingModel = ''
            customInputPrice = undefined
            customOutputPrice = undefined
        }
    }

    function updateCustomPricing(model: string, field: 'input' | 'output', value: number) {
        if (!Number.isFinite(value) || value < 0) return
        const current = DBState.db.apiUsage.customPricing[model]
        if (!current) return
        setApiUsageCustomPricing(
            model,
            field === 'input' ? value : current.input,
            field === 'output' ? value : current.output,
        )
    }
</script>

<div class="flex flex-col gap-5 pb-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
            <h2 class="text-2xl font-bold mt-2">{language.apiUsageStatistics.title}</h2>
            <p class="text-sm text-textcolor2 mt-1">{language.apiUsageStatistics.description}</p>
        </div>
        <label class="flex w-full sm:w-auto items-center justify-between sm:justify-start gap-2 text-sm">
            <span class="text-textcolor2">{language.apiUsageStatistics.summaryPeriod}</span>
            <select
                class="rounded-md border border-darkborderc bg-darkbutton px-3 py-1.5 text-textcolor focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
                bind:value={summaryRange}
            >
                {#each summaryRangeOptions as option}
                    <option class="bg-darkbg" value={option.value}>{option.label}</option>
                {/each}
            </select>
        </label>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="rounded-lg border border-borderc bg-darkbg/60 p-4">
            <div class="flex items-center gap-2 text-textcolor2 text-sm">
                <ChartNoAxesCombinedIcon size={18} />
                <span>{language.apiUsageStatistics.totalTokens}</span>
            </div>
            <div class="text-2xl font-semibold mt-2">{formatNumber(getTotalTokens(summaryTotals))}</div>
            <div class="text-xs text-textcolor2 mt-1">
                {language.apiUsageStatistics.input} {formatNumber(summaryTotals.inputTokens)} · {language.apiUsageStatistics.output} {formatNumber(summaryTotals.outputTokens)}
            </div>
        </div>

        <div class="rounded-lg border border-borderc bg-darkbg/60 p-4">
            <div class="flex items-center gap-2 text-textcolor2 text-sm">
                <CoinsIcon size={18} />
                <span>{language.apiUsageStatistics.estimatedCost}</span>
            </div>
            <div class="text-2xl font-semibold mt-2">
                {formatCost(summaryTotals.estimatedCostUsd)}{summaryTotals.unpricedRequestCount > 0 ? '+' : ''}
            </div>
            {#if summaryTotals.unpricedRequestCount > 0}
                <div class="text-xs text-textcolor2 mt-1">
                    {formatNumber(summaryTotals.unpricedRequestCount)} {language.apiUsageStatistics.unpricedRequests}
                </div>
            {/if}
        </div>

        <div class="rounded-lg border border-borderc bg-darkbg/60 p-4">
            <div class="flex items-center gap-2 text-textcolor2 text-sm">
                <CalendarDaysIcon size={18} />
                <span>{language.apiUsageStatistics.requestCount}</span>
            </div>
            <div class="text-2xl font-semibold mt-2">{formatNumber(summaryTotals.requestCount)}</div>
            <div class="text-xs text-textcolor2 mt-1">{getRequestStatusSummary(summaryTotals)}</div>
            <div class="text-xs text-textcolor2 mt-0.5">{getRequestModeSummary(summaryTotals)}</div>
        </div>
    </div>

    <section class="rounded-lg border border-borderc bg-darkbg/35 p-4">
        <div>
            <h3 class="font-semibold">{language.apiUsageStatistics.customPricing}</h3>
            <p class="text-xs text-textcolor2 mt-1">{language.apiUsageStatistics.customPricingDescription}</p>
            <p class="text-xs text-textcolor2 mt-1">{language.apiUsageStatistics.customPricingFutureOnly}</p>
        </div>

        <form
            class="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(8rem,0.6fr)_minmax(8rem,0.6fr)_auto] gap-2 mt-4"
            onsubmit={saveCustomPricing}
        >
            <label class="flex flex-col gap-1 text-xs text-textcolor2">
                <span>{language.apiUsageStatistics.modelId}</span>
                <input
                    class="h-10 rounded-md border border-darkborderc bg-darkbutton px-3 text-sm text-textcolor focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
                    list="api-usage-recorded-models"
                    autocomplete="off"
                    spellcheck={false}
                    bind:value={customPricingModel}
                />
            </label>
            <label class="flex flex-col gap-1 text-xs text-textcolor2">
                <span>{language.apiUsageStatistics.input} ({language.apiUsageStatistics.pricePerMillion})</span>
                <input
                    class="h-10 rounded-md border border-darkborderc bg-darkbutton px-3 text-sm text-textcolor focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
                    type="number"
                    min="0"
                    step="any"
                    bind:value={customInputPrice}
                />
            </label>
            <label class="flex flex-col gap-1 text-xs text-textcolor2">
                <span>{language.apiUsageStatistics.output} ({language.apiUsageStatistics.pricePerMillion})</span>
                <input
                    class="h-10 rounded-md border border-darkborderc bg-darkbutton px-3 text-sm text-textcolor focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
                    type="number"
                    min="0"
                    step="any"
                    bind:value={customOutputPrice}
                />
            </label>
            <button
                class="h-10 md:self-end inline-flex items-center justify-center gap-1.5 rounded-md bg-selected px-3 text-sm text-textcolor disabled:cursor-not-allowed disabled:opacity-40"
                type="submit"
                disabled={!canSaveCustomPricing}
            >
                <PlusIcon size={16} />
                {language.apiUsageStatistics.savePrice}
            </button>
        </form>

        <datalist id="api-usage-recorded-models">
            {#each recordedModels as model}
                <option value={model}></option>
            {/each}
        </datalist>

        {#if customPricingEntries.length === 0}
            <p class="text-sm text-textcolor2 mt-4">{language.apiUsageStatistics.noCustomPricing}</p>
        {:else}
            <div class="flex flex-col gap-2 mt-4">
                {#each customPricingEntries as [model, rate]}
                    <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(8rem,0.6fr)_minmax(8rem,0.6fr)_auto] items-end gap-2 rounded-md border border-borderc/70 bg-darkbg/40 p-3">
                        <div class="min-w-0 self-center">
                            <div class="text-xs text-textcolor2">{language.apiUsageStatistics.modelId}</div>
                            <div class="break-all font-mono text-sm">{model}</div>
                        </div>
                        <label class="flex flex-col gap-1 text-xs text-textcolor2">
                            <span>{language.apiUsageStatistics.input} ({language.apiUsageStatistics.pricePerMillion})</span>
                            <input
                                class="h-10 rounded-md border border-darkborderc bg-darkbutton px-3 text-sm text-textcolor focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
                                type="number"
                                min="0"
                                step="any"
                                value={rate.input}
                                onchange={(event) => updateCustomPricing(model, 'input', event.currentTarget.valueAsNumber)}
                            />
                        </label>
                        <label class="flex flex-col gap-1 text-xs text-textcolor2">
                            <span>{language.apiUsageStatistics.output} ({language.apiUsageStatistics.pricePerMillion})</span>
                            <input
                                class="h-10 rounded-md border border-darkborderc bg-darkbutton px-3 text-sm text-textcolor focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
                                type="number"
                                min="0"
                                step="any"
                                value={rate.output}
                                onchange={(event) => updateCustomPricing(model, 'output', event.currentTarget.valueAsNumber)}
                            />
                        </label>
                        <button
                            class="size-10 md:self-end inline-flex items-center justify-center rounded-md border border-borderc text-textcolor2 hover:bg-textcolor/10 hover:text-textcolor"
                            type="button"
                            title={language.apiUsageStatistics.deletePrice}
                            aria-label={`${language.apiUsageStatistics.deletePrice}: ${model}`}
                            onclick={() => deleteApiUsageCustomPricing(model)}
                        >
                            <TrashIcon size={17} />
                        </button>
                    </div>
                {/each}
            </div>
        {/if}
    </section>

    <section class="rounded-lg border border-borderc bg-darkbg/35 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
                <h3 class="font-semibold">{language.apiUsageStatistics.dailyActivity}</h3>
                <p class="text-xs text-textcolor2">{language.apiUsageStatistics.heatmapDescription}</p>
            </div>
            <div class="flex items-center gap-1.5 text-xs text-textcolor2">
                <span>{language.apiUsageStatistics.less}</span>
                {#each [0, 1, 2, 3, 4] as level}
                    <span class={`block size-3 rounded-[2px] ${getHeatmapClass({ level, future: false } as HeatmapDay)}`}></span>
                {/each}
                <span>{language.apiUsageStatistics.more}</span>
            </div>
        </div>

        <div class="overflow-x-auto pb-2">
            <div class="grid grid-flow-col grid-rows-7 auto-cols-max gap-[2px] w-max">
                {#each heatmapDays as day}
                    <button
                        type="button"
                        class={`size-3 rounded-[2px] p-0 ${getHeatmapClass(day)}`}
                        class:outline={selectedDate === day.key}
                        class:outline-1={selectedDate === day.key}
                        class:outline-textcolor={selectedDate === day.key}
                        disabled={day.future}
                        title={day.future ? '' : getDayLabel(day)}
                        aria-label={day.future ? undefined : getDayLabel(day)}
                        onclick={() => selectedDate = day.key}
                    ></button>
                {/each}
            </div>
        </div>

        <div class="mt-3 pt-3 border-t border-borderc/70">
            <div class="font-medium">{formatDate(new Date(`${selectedDate}T12:00:00`))}</div>
            {#if selectedStats}
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-sm">
                    <div><span class="text-textcolor2">{language.apiUsageStatistics.input}</span><br>{formatNumber(selectedStats.inputTokens)}</div>
                    <div><span class="text-textcolor2">{language.apiUsageStatistics.output}</span><br>{formatNumber(selectedStats.outputTokens)}</div>
                    <div>
                        <span class="text-textcolor2">{language.apiUsageStatistics.requests}</span><br>{formatNumber(selectedStats.requestCount)}
                        <div class="text-xs text-textcolor2 mt-1">{getRequestStatusSummary(selectedStats)}</div>
                        <div class="text-xs text-textcolor2 mt-0.5">{getRequestModeSummary(selectedStats)}</div>
                    </div>
                    <div>
                        <span class="text-textcolor2">{language.apiUsageStatistics.estimatedCost}</span><br>{formatCost(selectedStats.estimatedCostUsd)}
                        {#if selectedStats.unpricedRequestCount > 0}
                            <span class="text-xs text-textcolor2"> + {selectedStats.unpricedRequestCount} {language.apiUsageStatistics.unpriced}</span>
                        {/if}
                    </div>
                </div>
            {:else}
                <p class="text-sm text-textcolor2 mt-1">{language.apiUsageStatistics.noActivity}</p>
            {/if}
        </div>
    </section>

    <p class="text-xs text-textcolor2 leading-relaxed">{language.apiUsageStatistics.disclaimer}</p>
</div>
