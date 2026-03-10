/**
 * lazyLoad - A Svelte action for queued image loading.
 *
 * Prevents the Tauri IPC bridge from being overwhelmed by too many
 * concurrent image requests by enforcing a concurrency limit.
 *
 * Usage in Svelte component:
 *   <img use:lazyLoad={{ src: imageUrl }} alt="..." />
 *
 * The action will:
 * 1. Initially set the img src to empty (or a placeholder).
 * 2. Queue the real src assignment.
 * 3. Process the queue with a concurrency limit.
 * 4. Use IntersectionObserver to only load when visible.
 */

const MAX_CONCURRENT = 3
let activeCount = 0
const queue: Array<() => void> = []

function processQueue() {
    while (activeCount < MAX_CONCURRENT && queue.length > 0) {
        const next = queue.shift()
        if (next) {
            activeCount++
            next()
        }
    }
}

function onLoadComplete() {
    activeCount--
    processQueue()
}

export function lazyLoad(
    node: HTMLImageElement,
    params: { src: string; placeholder?: string }
) {
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    observer.unobserve(node)
                    enqueueLoad()
                }
            }
        },
        { rootMargin: '200px' }
    )

    // Set placeholder initially
    if (params.placeholder) {
        node.src = params.placeholder
    }

    function enqueueLoad() {
        queue.push(() => {
            node.src = params.src
            node.decoding = 'async'

            const handleDone = () => {
                onLoadComplete()
                node.removeEventListener('load', handleDone)
                node.removeEventListener('error', handleDone)
            }

            node.addEventListener('load', handleDone)
            node.addEventListener('error', handleDone)
        })
        processQueue()
    }

    observer.observe(node)

    return {
        update(newParams: { src: string; placeholder?: string }) {
            params = newParams
            // Re-enqueue if src changed
            if (node.src !== newParams.src) {
                enqueueLoad()
            }
        },
        destroy() {
            observer.disconnect()
        },
    }
}
