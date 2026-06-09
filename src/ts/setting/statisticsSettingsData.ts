import type { SettingItem } from './types';

export const statisticsSettingsItems: SettingItem[] = [
    {
        id: 'stats.localTokenizerFallback',
        type: 'check',
        labelKey: 'modelUsageStatisticsLocalTokenizerFallback',
        bindKey: 'modelUsageStatisticsLocalTokenizerFallback',
        helpKey: 'modelUsageStatisticsLocalTokenizerFallback',
        classes: 'mt-4',
        keywords: ['statistics', 'usage', 'tokenizer', 'fallback'],
    },
];
