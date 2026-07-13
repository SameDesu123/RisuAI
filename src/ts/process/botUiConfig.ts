export interface BotUiConfigV1 {
    version: 1
    html: string
    css?: string
    openAction?: string
    layout?: {
        width?: number
        height?: number
        anchor?: 'top-left'|'top-right'|'bottom-left'|'bottom-right'|'center'
        offsetX?: number
        offsetY?: number
    }
}

export function normalizeBotUiConfig(value: unknown): BotUiConfigV1|undefined {
    if(!value || typeof value !== 'object') return undefined
    const input = value as Partial<BotUiConfigV1>
    if(input.version !== 1 || typeof input.html !== 'string') return undefined
    const layout = input.layout && typeof input.layout === 'object' ? input.layout : {}
    const anchors = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const
    return {
        version: 1,
        html: input.html,
        css: typeof input.css === 'string' ? input.css : '',
        openAction: typeof input.openAction === 'string' ? input.openAction : '',
        layout: {
            width: Number.isFinite(layout.width) ? layout.width : 480,
            height: Number.isFinite(layout.height) ? layout.height : 640,
            anchor: anchors.includes(layout.anchor as typeof anchors[number]) ? layout.anchor : 'bottom-right',
            offsetX: Number.isFinite(layout.offsetX) ? layout.offsetX : 16,
            offsetY: Number.isFinite(layout.offsetY) ? layout.offsetY : 16,
        },
    }
}
