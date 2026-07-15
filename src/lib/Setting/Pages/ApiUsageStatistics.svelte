<script lang="ts">
    import { CalendarDaysIcon, ChartNoAxesCombinedIcon, CoinsIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import { getApiUsageDateKey, type ApiUsageDay } from "src/ts/apiUsage";
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

    const yearTotals = $derived.by(() => {
        const cutoff = new Date(today)
        cutoff.setDate(today.getDate() - 364)
        const cutoffKey = getApiUsageDateKey(cutoff)
        return Object.entries(DBState.db.apiUsage.daily)
            .filter(([key]) => key >= cutoffKey && key <= getApiUsageDateKey(today))
            .reduce((totals, [, day]) => {
                totals.inputTokens += day.inputTokens
                totals.outputTokens += day.outputTokens
                totals.requestCount += day.requestCount
                totals.estimatedCostUsd += day.estimatedCostUsd
                totals.unpricedRequestCount += day.unpricedRequestCount
                return totals
            }, {
                inputTokens: 0,
                outputTokens: 0,
                requestCount: 0,
                estimatedCostUsd: 0,
                unpricedRequestCount: 0,
            })
    })

    const selectedStats = $derived(DBState.db.apiUsage.daily[selectedDate])

    function getTotalTokens(stats?: Pick<ApiUsageDay, 'inputTokens'|'outputTokens'>) {
        return (stats?.inputTokens ?? 0) + (stats?.outputTokens ?? 0)
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
</script>

<div class="flex flex-col gap-5 pb-6">
    <div>
        <h2 class="text-2xl font-bold mt-2">{language.apiUsageStatistics.title}</h2>
        <p class="text-sm text-textcolor2 mt-1">{language.apiUsageStatistics.description}</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="rounded-lg border border-borderc bg-darkbg/60 p-4">
            <div class="flex items-center gap-2 text-textcolor2 text-sm">
                <ChartNoAxesCombinedIcon size={18} />
                <span>{language.apiUsageStatistics.totalTokens}</span>
            </div>
            <div class="text-2xl font-semibold mt-2">{formatNumber(getTotalTokens(yearTotals))}</div>
            <div class="text-xs text-textcolor2 mt-1">
                {language.apiUsageStatistics.input} {formatNumber(yearTotals.inputTokens)} · {language.apiUsageStatistics.output} {formatNumber(yearTotals.outputTokens)}
            </div>
        </div>

        <div class="rounded-lg border border-borderc bg-darkbg/60 p-4">
            <div class="flex items-center gap-2 text-textcolor2 text-sm">
                <CoinsIcon size={18} />
                <span>{language.apiUsageStatistics.estimatedCost}</span>
            </div>
            <div class="text-2xl font-semibold mt-2">
                {formatCost(yearTotals.estimatedCostUsd)}{yearTotals.unpricedRequestCount > 0 ? '+' : ''}
            </div>
            {#if yearTotals.unpricedRequestCount > 0}
                <div class="text-xs text-textcolor2 mt-1">
                    {formatNumber(yearTotals.unpricedRequestCount)} {language.apiUsageStatistics.unpricedRequests}
                </div>
            {/if}
        </div>

        <div class="rounded-lg border border-borderc bg-darkbg/60 p-4">
            <div class="flex items-center gap-2 text-textcolor2 text-sm">
                <CalendarDaysIcon size={18} />
                <span>{language.apiUsageStatistics.requestCount}</span>
            </div>
            <div class="text-2xl font-semibold mt-2">{formatNumber(yearTotals.requestCount)}</div>
            <div class="text-xs text-textcolor2 mt-1">{language.apiUsageStatistics.lastYear}</div>
        </div>
    </div>

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
                    <div><span class="text-textcolor2">{language.apiUsageStatistics.requests}</span><br>{formatNumber(selectedStats.requestCount)}</div>
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
