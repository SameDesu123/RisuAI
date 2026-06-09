import { DBState } from "./stores.svelte";

export interface ModelUsageDailyRecord {
    date: string;
    tokens: number;
    requests: number;
}

export interface ModelUsageStatistics {
    daily: Record<string, ModelUsageDailyRecord>;
}

export interface RequestUsageMetadata {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

const MAX_DAILY_USAGE_RECORDS = 120;

export function createDefaultModelUsageStatistics(): ModelUsageStatistics {
    return {
        daily: {},
    };
}

function getUsageDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");

    return `${year}-${month}-${day}`;
}

export function normalizeRequestUsageMetadata(usage: unknown): RequestUsageMetadata | undefined {
    if (!usage || typeof usage !== "object") {
        return undefined;
    }

    const data = usage as Record<string, unknown>;
    const promptTokens = Number(data.prompt_tokens ?? data.promptTokenCount ?? data.input_tokens ?? data.inputTokens);
    const completionTokens = Number(data.completion_tokens ?? data.candidatesTokenCount ?? data.output_tokens ?? data.outputTokens);
    const totalTokens = Number(data.total_tokens ?? data.totalTokenCount ?? data.totalTokens);

    return {
        promptTokens: Number.isFinite(promptTokens) ? promptTokens : undefined,
        completionTokens: Number.isFinite(completionTokens) ? completionTokens : undefined,
        totalTokens: Number.isFinite(totalTokens) ? totalTokens : undefined,
    };
}

export function getRequestUsageTokenCount(usage?: RequestUsageMetadata) {
    if (!usage) {
        return 0;
    }

    if (typeof usage.totalTokens === "number") {
        return usage.totalTokens;
    }

    return (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
}

export function recordModelUsageStatistics(usage?: RequestUsageMetadata, fallbackTokens = 0) {
    DBState.db.modelUsageStatistics ??= createDefaultModelUsageStatistics();
    DBState.db.modelUsageStatistics.daily ??= {};

    const date = getUsageDate();
    const usageTokens = getRequestUsageTokenCount(usage);
    const tokens = usageTokens > 0 ? usageTokens : fallbackTokens;
    let dailyRecord = DBState.db.modelUsageStatistics.daily[date];

    if (!dailyRecord) {
        dailyRecord = {
            date,
            tokens: 0,
            requests: 0,
        };
        DBState.db.modelUsageStatistics.daily[date] = dailyRecord;
    }

    dailyRecord.requests += 1;
    dailyRecord.tokens += tokens;
    DBState.db.modelUsageStatistics.daily = Object.fromEntries(
        Object.entries(DBState.db.modelUsageStatistics.daily)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-MAX_DAILY_USAGE_RECORDS),
    );
}

export function addModelUsageStatisticsTokens(tokens: number) {
    if (!Number.isFinite(tokens) || tokens <= 0) {
        return;
    }

    DBState.db.modelUsageStatistics ??= createDefaultModelUsageStatistics();
    DBState.db.modelUsageStatistics.daily ??= {};

    const date = getUsageDate();
    let dailyRecord = DBState.db.modelUsageStatistics.daily[date];

    if (!dailyRecord) {
        dailyRecord = {
            date,
            tokens: 0,
            requests: 0,
        };
        DBState.db.modelUsageStatistics.daily[date] = dailyRecord;
    }

    dailyRecord.tokens += tokens;
    DBState.db.modelUsageStatistics.daily = Object.fromEntries(
        Object.entries(DBState.db.modelUsageStatistics.daily)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-MAX_DAILY_USAGE_RECORDS),
    );
}
