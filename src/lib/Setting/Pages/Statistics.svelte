<script lang="ts">
    import { language } from "src/lang";
    import SegmentedControl from "src/lib/UI/GUI/SegmentedControl.svelte";
    import { statisticsSettingsItems } from "src/ts/setting/statisticsSettingsData";
    import { DBState } from "src/ts/stores.svelte";
    import SettingRenderer from "../SettingRenderer.svelte";

    interface UsagePoint {
        date: string;
        tokens: number;
        requests: number;
    }

    let submenu = $state(0);
    let usageRangeDays = $state(14);

    const usageRangeOptions = [
        { value: 14, label: language.last14Days },
        { value: 30, label: language.last30Days },
    ];

    const chartWidth = 720;
    const chartHeight = 280;
    const padding = {
        top: 18,
        right: 24,
        bottom: 42,
        left: 58,
    };

    function getDateKey(date: Date) {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        const day = `${date.getDate()}`.padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    function getUsageDateRange(days: number) {
        const today = new Date();

        return Array.from({ length: days }, (_, index) => {
            const date = new Date(today);
            date.setHours(0, 0, 0, 0);
            date.setDate(today.getDate() - (days - 1 - index));

            return getDateKey(date);
        });
    }

    const usagePoints = $derived(getUsageDateRange(usageRangeDays).map((date) => {
        const record = DBState.db.modelUsageStatistics?.daily?.[date];

        return {
            date,
            tokens: record?.tokens ?? 0,
            requests: record?.requests ?? 0,
        };
    }));

    function formatTokenCount(tokens: number) {
        if (tokens >= 1000000) {
            return `${(tokens / 1000000).toFixed(1)}M`;
        }

        if (tokens >= 1000) {
            return `${(tokens / 1000).toFixed(1)}K`;
        }

        return tokens.toString();
    }

    function formatDateLabel(date: string) {
        const [year, month, day] = date.split("-").map(Number);
        const parsed = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
            ? new Date(year, month - 1, day)
            : new Date(date);

        if (Number.isNaN(parsed.getTime())) {
            return date;
        }

        return parsed.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
        });
    }

    function formatRequestCount(requests: number) {
        return requests.toLocaleString();
    }

    function shouldShowDateLabel(index: number, total: number) {
        if (index === 0 || index === total - 1) {
            return true;
        }

        return total <= 14
            ? index % 2 === 0
            : index % 7 === 0;
    }

    function getYGrid(maxValue: number) {
        const step = maxValue / 4;

        return Array.from({ length: 5 }, (_, index) => {
            const value = Math.round(step * index);
            const y = chartHeight - padding.bottom - ((chartHeight - padding.top - padding.bottom) * value) / maxValue;

            return {
                value,
                y,
            };
        });
    }

    function getLinePath(points: { x: number; y: number }[]) {
        if (points.length === 0) {
            return "";
        }

        if (points.length === 1) {
            return `M ${points[0].x} ${points[0].y}`;
        }

        let path = `M ${points[0].x} ${points[0].y}`;

        for (let index = 1; index < points.length; index += 1) {
            const previous = points[index - 1];
            const current = points[index];
            const midX = (previous.x + current.x) / 2;
            const midY = (previous.y + current.y) / 2;

            path += ` Q ${previous.x} ${previous.y} ${midX} ${midY}`;
        }

        const last = points[points.length - 1];
        path += ` T ${last.x} ${last.y}`;

        return path;
    }

    function buildChart(points: UsagePoint[], getValue: (point: UsagePoint) => number) {
        const maxValue = Math.max(...points.map(getValue), 1);
        const plotWidth = chartWidth - padding.left - padding.right;
        const plotHeight = chartHeight - padding.top - padding.bottom;
        const xStep = points.length > 1 ? plotWidth / (points.length - 1) : 0;
        const chartPoints = points.map((point, index) => ({
            date: point.date,
            value: getValue(point),
            x: points.length > 1 ? padding.left + xStep * index : padding.left + plotWidth / 2,
            y: chartHeight - padding.bottom - (plotHeight * getValue(point)) / maxValue,
        }));

        return {
            maxValue,
            chartPoints,
            grid: getYGrid(maxValue),
            path: getLinePath(chartPoints),
            hasData: points.some((point) => getValue(point) > 0),
            barWidth: points.length > 1 ? Math.max(4, Math.min(18, xStep * 0.58)) : 18,
        };
    }

    const tokenUsageChart = $derived(buildChart(usagePoints, (point) => point.tokens));
    const requestUsageChart = $derived(buildChart(usagePoints, (point) => point.requests));
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.statistics}</h2>

<div class="flex w-full rounded-md border border-darkborderc mb-4">
    <button onclick={() => {
        submenu = 0
    }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 0}>
        <span>Model Usage</span>
    </button>
    <button onclick={() => {
        submenu = 1
    }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 1}>
        <span>Pricing</span>
    </button>
    <button onclick={() => {
        submenu = 2
    }} class="p-2 flex-1" class:bg-darkbutton={submenu === 2}>
        <span>Settings</span>
    </button>
</div>

{#if submenu === 0}
    <div class="mb-3 flex w-full flex-wrap items-center justify-between gap-2">
        <span class="text-lg font-semibold text-textcolor">Model Usage</span>
        <SegmentedControl bind:value={usageRangeDays} options={usageRangeOptions} size="sm" className="!mb-0" />
    </div>

    <div class="w-full rounded-md border border-darkborderc bg-darkbg/30 p-4">
        <svg
            class="h-72 w-full overflow-visible text-textcolor"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label="Token usage by date"
        >
            {#each tokenUsageChart.grid as gridLine}
                <line
                    x1={padding.left}
                    y1={gridLine.y}
                    x2={chartWidth - padding.right}
                    y2={gridLine.y}
                    class="stroke-textcolor/10"
                    stroke-width="1"
                />
                <text
                    x={padding.left - 12}
                    y={gridLine.y + 4}
                    text-anchor="end"
                    class="fill-textcolor2 text-[11px]"
                >
                    {formatTokenCount(gridLine.value)}
                </text>
            {/each}

            <line
                x1={padding.left}
                y1={padding.top}
                x2={padding.left}
                y2={chartHeight - padding.bottom}
                class="stroke-textcolor/30"
                stroke-width="1.5"
            />
            <line
                x1={padding.left}
                y1={chartHeight - padding.bottom}
                x2={chartWidth - padding.right}
                y2={chartHeight - padding.bottom}
                class="stroke-textcolor/30"
                stroke-width="1.5"
            />

            <text
                x={18}
                y={(chartHeight - padding.bottom + padding.top) / 2}
                text-anchor="middle"
                transform={`rotate(-90 18 ${(chartHeight - padding.bottom + padding.top) / 2})`}
                class="fill-textcolor2 text-[12px]"
            >
                Token Count
            </text>

            {#if tokenUsageChart.hasData}
                <path
                    d={tokenUsageChart.path}
                    fill="none"
                    class="stroke-selected"
                    stroke-width="4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />

                {#each tokenUsageChart.chartPoints as point, index}
                    <circle cx={point.x} cy={point.y} r="4" class="fill-selected" />
                    {#if shouldShowDateLabel(index, tokenUsageChart.chartPoints.length)}
                        <text
                            x={point.x}
                            y={chartHeight - 14}
                            text-anchor="middle"
                            class="fill-textcolor2 text-[11px]"
                        >
                            {formatDateLabel(point.date)}
                        </text>
                    {/if}
                {/each}
            {:else}
                <text
                    x={(chartWidth + padding.left - padding.right) / 2}
                    y={(chartHeight + padding.top - padding.bottom) / 2}
                    text-anchor="middle"
                    class="fill-textcolor2 text-[14px]"
                >
                    No usage data
                </text>
            {/if}
        </svg>

        <div class="mt-2 flex items-center justify-between text-sm text-textcolor2">
            <span>Date</span>
            <span>{formatTokenCount(tokenUsageChart.hasData ? tokenUsageChart.maxValue : 0)} max</span>
        </div>
    </div>

    <div class="mt-4 w-full rounded-md border border-darkborderc bg-darkbg/30 p-4">
        <svg
            class="h-72 w-full overflow-visible text-textcolor"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label="Request count by date"
        >
            {#each requestUsageChart.grid as gridLine}
                <line
                    x1={padding.left}
                    y1={gridLine.y}
                    x2={chartWidth - padding.right}
                    y2={gridLine.y}
                    class="stroke-textcolor/10"
                    stroke-width="1"
                />
                <text
                    x={padding.left - 12}
                    y={gridLine.y + 4}
                    text-anchor="end"
                    class="fill-textcolor2 text-[11px]"
                >
                    {formatRequestCount(gridLine.value)}
                </text>
            {/each}

            <line
                x1={padding.left}
                y1={padding.top}
                x2={padding.left}
                y2={chartHeight - padding.bottom}
                class="stroke-textcolor/30"
                stroke-width="1.5"
            />
            <line
                x1={padding.left}
                y1={chartHeight - padding.bottom}
                x2={chartWidth - padding.right}
                y2={chartHeight - padding.bottom}
                class="stroke-textcolor/30"
                stroke-width="1.5"
            />

            <text
                x={18}
                y={(chartHeight - padding.bottom + padding.top) / 2}
                text-anchor="middle"
                transform={`rotate(-90 18 ${(chartHeight - padding.bottom + padding.top) / 2})`}
                class="fill-textcolor2 text-[12px]"
            >
                Requests
            </text>

            {#if requestUsageChart.hasData}
                {#each requestUsageChart.chartPoints as point, index}
                    <rect
                        x={point.x - requestUsageChart.barWidth / 2}
                        y={point.y}
                        width={requestUsageChart.barWidth}
                        height={chartHeight - padding.bottom - point.y}
                        rx="4"
                        class="fill-selected"
                    />
                    {#if shouldShowDateLabel(index, requestUsageChart.chartPoints.length)}
                        <text
                            x={point.x}
                            y={chartHeight - 14}
                            text-anchor="middle"
                            class="fill-textcolor2 text-[11px]"
                        >
                            {formatDateLabel(point.date)}
                        </text>
                    {/if}
                {/each}
            {:else}
                <text
                    x={(chartWidth + padding.left - padding.right) / 2}
                    y={(chartHeight + padding.top - padding.bottom) / 2}
                    text-anchor="middle"
                    class="fill-textcolor2 text-[14px]"
                >
                    No usage data
                </text>
            {/if}
        </svg>

        <div class="mt-2 flex items-center justify-between text-sm text-textcolor2">
            <span>Date</span>
            <span>{formatRequestCount(requestUsageChart.hasData ? requestUsageChart.maxValue : 0)} max</span>
        </div>
    </div>
{/if}

{#if submenu === 2}
    <SettingRenderer items={statisticsSettingsItems} />
{/if}
