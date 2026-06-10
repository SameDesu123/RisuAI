<script lang="ts">
    import { language } from "src/lang";
    import SegmentedControl from "src/lib/UI/GUI/SegmentedControl.svelte";
    import { statisticsSettingsItems } from "src/ts/setting/statisticsSettingsData";
    import { DBState } from "src/ts/stores.svelte";
    import SettingRenderer from "../SettingRenderer.svelte";

    interface UsagePoint {
        date: string;
        tokens: number;
        inputTokens: number;
        outputTokens: number;
        requests: number;
    }

    type TokenHoverPoint = ReturnType<typeof buildTokenUsageChart>["chartPoints"][number];
    type RequestHoverPoint = ReturnType<typeof buildChart>["chartPoints"][number];

    let submenu = $state(0);
    let usageRangeDays = $state(14);
    let tokenHoverPoint: TokenHoverPoint | null = $state(null);
    let requestHoverPoint: RequestHoverPoint | null = $state(null);

    const usageRangeOptions = [
        { value: 14, label: language.last14Days },
        { value: 30, label: language.last30Days },
    ];

    const chartWidth = 720;
    const chartHeight = 280;
    const padding = {
        top: 18,
        right: 34,
        bottom: 58,
        left: 58,
    };
    const horizontalPlotInset = 18;
    const inputChartColor = "#93c5fd";
    const outputChartColor = "#86efac";
    const requestChartColor = "#c4b5fd";

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
            inputTokens: record?.inputTokens ?? 0,
            outputTokens: record?.outputTokens ?? Math.max(0, (record?.tokens ?? 0) - (record?.inputTokens ?? 0)),
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

    function formatDateLabelParts(date: string) {
        const [year, month, day] = date.split("-").map(Number);

        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
            return {
                month: date,
                day: "",
            };
        }

        return {
            month: `${month}월`,
            day: `${day}일`,
        };
    }

    function formatFullDateLabel(date: string) {
        const label = formatDateLabelParts(date);

        return label.day ? `${label.month} ${label.day}` : label.month;
    }

    function formatRequestCount(requests: number) {
        return requests.toLocaleString();
    }

    function getDateLabelFontSize(total: number) {
        return total > 14 ? 9 : 10;
    }

    function getRoundedChartMax(value: number) {
        if (value <= 0) {
            return 10;
        }

        const magnitude = 10 ** Math.floor(Math.log10(value));
        const normalized = value / magnitude;
        const roundedNormalized = normalized <= 1
            ? 1
            : normalized <= 2
                ? 2
                : normalized <= 5
                    ? 5
                    : 10;

        return Math.max(10, roundedNormalized * magnitude);
    }

    function getTooltipX(x: number, width: number) {
        return Math.min(Math.max(x - width / 2, padding.left), chartWidth - padding.right - width);
    }

    function getTooltipY(anchorY: number, height: number) {
        const aboveY = anchorY - height - 10;
        const maxY = chartHeight - padding.bottom - height - 8;

        if (aboveY >= padding.top + 8) {
            return aboveY;
        }

        return Math.min(Math.max(anchorY + 10, padding.top + 8), maxY);
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

        return points
            .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
            .join(" ");
    }

    function buildChart(points: UsagePoint[], getValue: (point: UsagePoint) => number) {
        const rawMaxValue = Math.max(...points.map(getValue), 0);
        const maxValue = getRoundedChartMax(rawMaxValue);
        const plotWidth = chartWidth - padding.left - padding.right;
        const plotHeight = chartHeight - padding.top - padding.bottom;
        const usablePlotWidth = plotWidth - horizontalPlotInset * 2;
        const xStep = points.length > 1 ? usablePlotWidth / (points.length - 1) : 0;
        const chartPoints = points.map((point, index) => ({
            date: point.date,
            value: getValue(point),
            x: points.length > 1 ? padding.left + horizontalPlotInset + xStep * index : padding.left + plotWidth / 2,
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

    function buildTokenUsageChart(points: UsagePoint[]) {
        const rawMaxValue = Math.max(...points.map((point) => point.inputTokens + point.outputTokens), 0);
        const maxValue = getRoundedChartMax(rawMaxValue);
        const plotWidth = chartWidth - padding.left - padding.right;
        const plotHeight = chartHeight - padding.top - padding.bottom;
        const usablePlotWidth = plotWidth - horizontalPlotInset * 2;
        const xStep = points.length > 1 ? usablePlotWidth / (points.length - 1) : 0;
        const barWidth = points.length > 1 ? Math.max(8, Math.min(22, xStep * 0.58)) : 22;
        const chartPoints = points.map((point, index) => {
            const x = points.length > 1 ? padding.left + horizontalPlotInset + xStep * index : padding.left + plotWidth / 2;
            const inputHeight = (plotHeight * point.inputTokens) / maxValue;
            const outputHeight = (plotHeight * point.outputTokens) / maxValue;
            const totalHeight = inputHeight + outputHeight;
            const barBottom = chartHeight - padding.bottom;
            const barTop = barBottom - totalHeight;

            return {
                date: point.date,
                inputValue: point.inputTokens,
                outputValue: point.outputTokens,
                x,
                barX: x - barWidth / 2,
                barTop,
                barBottom,
                barWidth,
                totalHeight,
                inputY: barBottom - inputHeight,
                inputHeight,
                outputY: barTop,
                outputHeight,
            };
        });

        return {
            maxValue,
            chartPoints,
            grid: getYGrid(maxValue),
            barWidth,
            hasData: points.some((point) => point.inputTokens > 0 || point.outputTokens > 0),
        };
    }

    const tokenUsageChart = $derived(buildTokenUsageChart(usagePoints));
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
        <div class="mb-2 flex items-center gap-4 text-xs text-textcolor2">
            <span class="inline-flex items-center gap-1">
                <span class="h-2 w-2 rounded-full" style={`background-color: ${inputChartColor}`}></span>
                {language.inputTokens}
            </span>
            <span class="inline-flex items-center gap-1">
                <span class="h-2 w-2 rounded-full" style={`background-color: ${outputChartColor}`}></span>
                {language.outputTokens}
            </span>
        </div>
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

            {#each tokenUsageChart.chartPoints as point, index}
                <line
                    x1={point.x}
                    y1={chartHeight - padding.bottom}
                    x2={point.x}
                    y2={chartHeight - padding.bottom + 5}
                    class="stroke-textcolor/25"
                    stroke-width="1"
                />
                {@const dateLabel = formatDateLabelParts(point.date)}
                <text
                    x={point.x}
                    y={chartHeight - 36}
                    text-anchor="middle"
                    class="fill-textcolor2"
                    font-size={getDateLabelFontSize(tokenUsageChart.chartPoints.length)}
                >
                    <tspan x={point.x}>{dateLabel.month}</tspan>
                    <tspan x={point.x} dy="12">{dateLabel.day}</tspan>
                </text>
            {/each}

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
                {#each tokenUsageChart.chartPoints as point, index}
                    {#if point.totalHeight > 0}
                        <clipPath id={`token-bar-clip-${index}`}>
                            <rect
                                x={point.barX}
                                y={point.barTop}
                                width={point.barWidth}
                                height={point.totalHeight}
                                rx="4"
                            />
                        </clipPath>
                        <g clip-path={`url(#token-bar-clip-${index})`}>
                            {#if point.inputHeight > 0}
                                <rect
                                    x={point.barX}
                                    y={point.inputY}
                                    width={point.barWidth}
                                    height={point.inputHeight}
                                    fill={inputChartColor}
                                />
                            {/if}
                            {#if point.outputHeight > 0}
                                <rect
                                    x={point.barX}
                                    y={point.outputY}
                                    width={point.barWidth}
                                    height={point.outputHeight}
                                    fill={outputChartColor}
                                />
                            {/if}
                        </g>
                    {/if}
                {/each}

                {#each tokenUsageChart.chartPoints as point}
                    <rect
                        role="button"
                        tabindex="0"
                        aria-label={`${formatFullDateLabel(point.date)} ${language.inputTokens} ${formatRequestCount(point.inputValue)}, ${language.outputTokens} ${formatRequestCount(point.outputValue)}`}
                        x={point.barX}
                        y={padding.top}
                        width={point.barWidth}
                        height={chartHeight - padding.top - padding.bottom}
                        fill="transparent"
                        onpointerenter={() => {
                            tokenHoverPoint = point;
                        }}
                        onpointermove={() => {
                            tokenHoverPoint = point;
                        }}
                        onpointerleave={() => {
                            tokenHoverPoint = null;
                        }}
                        onfocus={() => {
                            tokenHoverPoint = point;
                        }}
                        onblur={() => {
                            tokenHoverPoint = null;
                        }}
                    />
                {/each}

                {#if tokenHoverPoint}
                    {@const tooltipWidth = 178}
                    {@const tooltipHeight = 62}
                    {@const tooltipX = getTooltipX(tokenHoverPoint.x, tooltipWidth)}
                    {@const tooltipY = getTooltipY(tokenHoverPoint.barTop, tooltipHeight)}
                    <line
                        x1={tokenHoverPoint.x}
                        y1={padding.top}
                        x2={tokenHoverPoint.x}
                        y2={chartHeight - padding.bottom}
                        class="stroke-textcolor/20"
                        stroke-width="1"
                        stroke-dasharray="4 4"
                    />
                    <foreignObject x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight}>
                        <div class="h-full rounded-md bg-[#2f3035] px-3 py-2 text-[11px] leading-tight text-white shadow-lg">
                            <div class="mb-1 flex items-center justify-between gap-3 font-semibold">
                                <span>{formatFullDateLabel(tokenHoverPoint.date)}</span>
                                <span>{formatRequestCount(tokenHoverPoint.inputValue + tokenHoverPoint.outputValue)}</span>
                            </div>
                            <div class="flex items-center justify-between gap-3 text-white/80">
                                <span class="inline-flex items-center gap-1.5">
                                    <span class="h-2 w-2 rounded-sm" style={`background-color: ${inputChartColor}`}></span>
                                    {language.inputTokens}
                                </span>
                                <span>{formatRequestCount(tokenHoverPoint.inputValue)}</span>
                            </div>
                            <div class="mt-1 flex items-center justify-between gap-3 text-white/80">
                                <span class="inline-flex items-center gap-1.5">
                                    <span class="h-2 w-2 rounded-sm" style={`background-color: ${outputChartColor}`}></span>
                                    {language.outputTokens}
                                </span>
                                <span>{formatRequestCount(tokenHoverPoint.outputValue)}</span>
                            </div>
                        </div>
                    </foreignObject>
                {/if}
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

            {#each requestUsageChart.chartPoints as point, index}
                <line
                    x1={point.x}
                    y1={chartHeight - padding.bottom}
                    x2={point.x}
                    y2={chartHeight - padding.bottom + 5}
                    class="stroke-textcolor/25"
                    stroke-width="1"
                />
                {@const dateLabel = formatDateLabelParts(point.date)}
                <text
                    x={point.x}
                    y={chartHeight - 36}
                    text-anchor="middle"
                    class="fill-textcolor2"
                    font-size={getDateLabelFontSize(requestUsageChart.chartPoints.length)}
                >
                    <tspan x={point.x}>{dateLabel.month}</tspan>
                    <tspan x={point.x} dy="12">{dateLabel.day}</tspan>
                </text>
            {/each}

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
                        fill={requestChartColor}
                    />
                {/each}

                {#each requestUsageChart.chartPoints as point}
                    <rect
                        role="button"
                        tabindex="0"
                        aria-label={`${formatFullDateLabel(point.date)} Requests ${formatRequestCount(point.value)}`}
                        x={point.x - 9}
                        y={padding.top}
                        width="18"
                        height={chartHeight - padding.top - padding.bottom}
                        fill="transparent"
                        onpointerenter={() => {
                            requestHoverPoint = point;
                        }}
                        onpointermove={() => {
                            requestHoverPoint = point;
                        }}
                        onpointerleave={() => {
                            requestHoverPoint = null;
                        }}
                        onfocus={() => {
                            requestHoverPoint = point;
                        }}
                        onblur={() => {
                            requestHoverPoint = null;
                        }}
                    />
                {/each}

                {#if requestHoverPoint}
                    {@const tooltipWidth = 130}
                    {@const tooltipHeight = 44}
                    {@const tooltipX = getTooltipX(requestHoverPoint.x, tooltipWidth)}
                    {@const tooltipY = getTooltipY(requestHoverPoint.y, tooltipHeight)}
                    <line
                        x1={requestHoverPoint.x}
                        y1={padding.top}
                        x2={requestHoverPoint.x}
                        y2={chartHeight - padding.bottom}
                        class="stroke-textcolor/20"
                        stroke-width="1"
                        stroke-dasharray="4 4"
                    />
                    <foreignObject x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight}>
                        <div class="h-full rounded-md bg-[#2f3035] px-3 py-2 text-[11px] leading-tight text-white shadow-lg">
                            <div class="mb-1 font-semibold">{formatFullDateLabel(requestHoverPoint.date)}</div>
                            <div class="flex justify-between gap-3 text-white/80">
                                <span>Requests</span>
                                <span>{formatRequestCount(requestHoverPoint.value)}</span>
                            </div>
                        </div>
                    </foreignObject>
                {/if}
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
