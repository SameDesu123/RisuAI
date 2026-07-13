import { describe, expect, test } from 'vitest'
import { normalizeBotUiConfig } from '../process/botUiConfig'

describe('Bot UI card configuration', () => {
    test('leaves old cards without Bot UI untouched', () => {
        expect(normalizeBotUiConfig(undefined)).toBeUndefined()
        expect(normalizeBotUiConfig({ version: 2, html: '<p>future</p>' })).toBeUndefined()
    })

    test('normalizes optional layout values without changing creator HTML', () => {
        expect(normalizeBotUiConfig({ version: 1, html: '<main>Inn</main>' })).toEqual({
            version: 1,
            html: '<main>Inn</main>',
            css: '',
            openAction: '',
            layout: {
                width: 480,
                height: 640,
                anchor: 'bottom-right',
                offsetX: 16,
                offsetY: 16,
            },
        })
    })
})
