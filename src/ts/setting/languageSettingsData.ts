/**
 * Language Settings Data
 *
 * Data-driven definition of all settings in LanguageSettings page.
 */

import type { SettingItem } from './types';
import { isTauri } from '../platform';

export const languageSettingsItems: SettingItem[] = [
    // Header
    {
        id: 'lang.header',
        type: 'header',
        labelKey: 'language',
        options: { level: 'h2' },
    },

    // UI Language Selector (custom component: translang dialog + langChanged warning)
    {
        id: 'lang.uiLanguage',
        type: 'custom',
        componentId: 'LanguageUiSelector',
    },

    // Translator Language
    {
        id: 'lang.translatorLanguage',
        type: 'select',
        labelKey: 'translatorLanguage',
        bindKey: 'translator',
        options: {
            selectOptions: [
                { value: '', labelKey: 'disabled' },
                { value: 'ko', label: 'Korean' },
                { value: 'ru', label: 'Russian' },
                { value: 'zh', label: 'Chinese' },
                { value: 'zh-TW', label: 'Chinese (Traditional)', condition: (ctx) => ctx.db.translatorType === 'google' },
                { value: 'fa', label: 'Persian (Farsi)', condition: (ctx) => ctx.db.translatorType === 'google' },
                { value: 'ja', label: 'Japanese' },
                { value: 'fr', label: 'French' },
                { value: 'es', label: 'Spanish' },
                { value: 'pt', label: 'Portuguese' },
                { value: 'de', label: 'German' },
                { value: 'id', label: 'Indonesian' },
                { value: 'ms', label: 'Malaysian' },
                { value: 'uk', label: 'Ukranian' },
            ],
        },
    },

    // Translator Type (only when translator is enabled)
    {
        id: 'lang.translatorType',
        type: 'select',
        labelKey: 'translatorType',
        bindKey: 'translatorType',
        condition: (ctx) => !!ctx.db.translator,
        options: {
            selectOptions: [
                { value: 'google', label: 'Google' },
                { value: 'deepl', label: 'DeepL' },
                { value: 'llm', label: 'Ax. Model' },
                { value: 'deeplX', label: 'DeepL X' },
                { value: 'bergamot', label: 'Firefox' },
            ],
        },
    },

    // DeepL: web version warning
    {
        id: 'lang.deeplWebWarn',
        type: 'header',
        labelKey: 'webdeeplwarn',
        options: { level: 'warning' },
        condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'deepl' && !isTauri,
    },

    // DeepL: API Key
    {
        id: 'lang.deeplKey',
        type: 'text',
        labelKey: 'deeplKey',
        bindPath: 'deeplOptions.key',
        condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'deepl',
    },

    // DeepL: Free API
    {
        id: 'lang.deeplFreeApi',
        type: 'check',
        labelKey: 'deeplFreeKey',
        bindPath: 'deeplOptions.freeApi',
        condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'deepl',
    },

    // DeepL X: URL
    {
        id: 'lang.deeplXUrl',
        type: 'text',
        labelKey: 'deeplXUrl',
        bindPath: 'deeplXOptions.url',
        condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'deeplX',
        options: { placeholder: 'http://localhost:1188' },
    },

    // DeepL X: Token
    {
        id: 'lang.deeplXToken',
        type: 'text',
        labelKey: 'deeplXToken',
        bindPath: 'deeplXOptions.token',
        condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'deeplX',
    },

    // LLM: Translation Response Size
    {
        id: 'lang.translatorMaxResponse',
        type: 'number',
        labelKey: 'translationResponseSize',
        bindKey: 'translatorMaxResponse',
        condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'llm',
        options: { min: 0, max: 2048 },
    },

    // LLM: Translator Prompt
    {
        id: 'lang.translatorPrompt',
        type: 'textarea',
        labelKey: 'translatorPrompt',
        bindKey: 'translatorPrompt',
        helpKey: 'translatorPrompt',
        condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'llm',
        options: {
            placeholder: 'You are a translator. translate the following html or text into {{slot}}. do not output anything other than the translation.',
        },
    },

    // Google: Source Language
    {
        id: 'lang.sourceLanguage',
        type: 'select',
        labelKey: 'sourceLanguage',
        bindKey: 'translatorInputLanguage',
        condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'google',
        options: {
            selectOptions: [
                { value: 'auto', label: 'Auto' },
                { value: 'en', label: 'English' },
                { value: 'zh', label: 'Chinese' },
                { value: 'ja', label: 'Japanese' },
                { value: 'ko', label: 'Korean' },
                { value: 'fr', label: 'French' },
                { value: 'es', label: 'Spanish' },
                { value: 'de', label: 'German' },
                { value: 'ru', label: 'Russian' },
            ],
        },
    },

    // Bergamot: HTML Translation
    {
        id: 'lang.htmlTranslation',
        type: 'check',
        labelKey: 'htmlTranslation',
        bindKey: 'htmlTranslation',
        condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'bergamot',
    },

    // Auto Translation
    {
        id: 'lang.autoTranslate',
        type: 'check',
        labelKey: 'autoTranslation',
        bindKey: 'autoTranslate',
        condition: (ctx) => !!ctx.db.translator,
    },

    // Combine Translation
    {
        id: 'lang.combineTranslation',
        type: 'check',
        labelKey: 'combineTranslation',
        bindKey: 'combineTranslation',
        helpKey: 'combineTranslation',
        condition: (ctx) => !!ctx.db.translator,
        classes: 'mt-4',
    },

    // Legacy Translation
    {
        id: 'lang.legacyTranslation',
        type: 'check',
        labelKey: 'legacyTranslation',
        bindKey: 'legacyTranslation',
        helpKey: 'legacyTranslation',
        condition: (ctx) => !!ctx.db.translator,
        classes: 'mt-4',
    },

    // Translate Before HTML Formatting (LLM only)
    {
        id: 'lang.translateBeforeHTML',
        type: 'check',
        labelKey: 'translateBeforeHTMLFormatting',
        bindKey: 'translateBeforeHTMLFormatting',
        helpKey: 'translateBeforeHTMLFormatting',
        condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'llm',
        classes: 'mt-4',
    },

    // Auto Translate Cached Only (LLM only)
    {
        id: 'lang.autoTranslateCachedOnly',
        type: 'check',
        labelKey: 'autoTranslateCachedOnly',
        bindKey: 'autoTranslateCachedOnly',
        helpKey: 'autoTranslateCachedOnly',
        condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'llm',
        classes: 'mt-4',
    },
];
