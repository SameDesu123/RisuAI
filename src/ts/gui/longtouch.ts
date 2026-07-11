export function longpress(node: HTMLElement, callback: (event: MouseEvent) => void) {
    const holdDurationMs = 500
    const moveTolerancePx = 10
    let timeout: number | null = null
    let activePointer: { id: number, x: number, y: number } | null = null

    const clear = () => {
        if (timeout !== null) {
            window.clearTimeout(timeout)
            timeout = null
        }
        activePointer = null
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerEnd)
        window.removeEventListener('pointercancel', handlePointerEnd)
    }

    const handlePointerMove = (event: PointerEvent) => {
        if (!activePointer || event.pointerId !== activePointer.id) return
        if (
            Math.abs(event.clientX - activePointer.x) > moveTolerancePx ||
            Math.abs(event.clientY - activePointer.y) > moveTolerancePx
        ) {
            clear()
        }
    }

    const handlePointerEnd = (event: PointerEvent) => {
        if (activePointer && event.pointerId === activePointer.id) {
            clear()
        }
    }

    const handlePointerDown = (event: PointerEvent) => {
        if (!event.isPrimary || event.button !== 0) return
        clear()
        activePointer = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
        }
        window.addEventListener('pointermove', handlePointerMove, { passive: true })
        window.addEventListener('pointerup', handlePointerEnd, { passive: true })
        window.addEventListener('pointercancel', handlePointerEnd, { passive: true })
        timeout = window.setTimeout(() => {
            timeout = null
            activePointer = null
            callback(event)
        }, holdDurationMs)
    }

    node.addEventListener('pointerdown', handlePointerDown)
    return {
        destroy: () => {
            clear()
            node.removeEventListener('pointerdown', handlePointerDown)
        }
    }
}
