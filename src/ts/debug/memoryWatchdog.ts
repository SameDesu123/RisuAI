import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../platform'

type MemoryWatchdogProbe = () => string

const FRONTEND_SAMPLE_INTERVAL_MS = 5000
const IMAGE_SAMPLE_INTERVAL_MS = 10000
const probes = new Map<string, MemoryWatchdogProbe>()
let started = false
let sampleInFlight = false
let lastImageSampleAt = 0

function sanitizeInline(value: string) {
    return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function registerMemoryWatchdogProbe(name: string, probe: MemoryWatchdogProbe) {
    probes.set(name, probe)
}

export function memoryWatchdogEvent(event: string, detail = '') {
    if (!isTauri) {
        return
    }

    const heapDetail = collectBrowserMemoryProbe()
    const combinedDetail = [sanitizeInline(detail), heapDetail]
        .filter(Boolean)
        .join(';')

    void invoke('memory_watchdog_event', {
        event,
        detail: combinedDetail,
    }).catch((error) => {
        console.warn('[memory-watchdog] failed to write event', error)
    })
}

export async function getMemoryWatchdogLogPath() {
    if (!isTauri) {
        return ''
    }
    return await invoke<string>('memory_watchdog_log_path')
}

function collectBrowserMemoryProbe() {
    const parts: string[] = []
    const performanceWithMemory = performance as Performance & {
        memory?: {
            usedJSHeapSize: number
            totalJSHeapSize: number
            jsHeapSizeLimit: number
        }
    }

    const memory = performanceWithMemory.memory
    if (memory) {
        parts.push(`js_heap_used_bytes=${memory.usedJSHeapSize}`)
        parts.push(`js_heap_total_bytes=${memory.totalJSHeapSize}`)
        parts.push(`js_heap_limit_bytes=${memory.jsHeapSizeLimit}`)
    }

    return parts.join(';')
}

function collectImageProbe() {
    let loadedImageElements = 0
    let decodedImageBytesEstimate = 0
    let sidebarImageElements = 0
    let sidebarDecodedImageBytesEstimate = 0

    const uniqueImages = new Map<string, number>()
    const uniqueSidebarImages = new Map<string, number>()

    for (const image of document.images) {
        if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
            continue
        }

        loadedImageElements += 1
        const src = image.currentSrc || image.src
        const estimatedBytes = image.naturalWidth * image.naturalHeight * 4
        const previous = uniqueImages.get(src) ?? 0
        if (estimatedBytes > previous) {
            uniqueImages.set(src, estimatedBytes)
        }

        if (image.classList.contains('sidebar-avatar')) {
            sidebarImageElements += 1
            const previousSidebar = uniqueSidebarImages.get(src) ?? 0
            if (estimatedBytes > previousSidebar) {
                uniqueSidebarImages.set(src, estimatedBytes)
            }
        }
    }

    for (const bytes of uniqueImages.values()) {
        decodedImageBytesEstimate += bytes
    }
    for (const bytes of uniqueSidebarImages.values()) {
        sidebarDecodedImageBytesEstimate += bytes
    }

    return [
        `img_elements=${document.images.length}`,
        `img_loaded=${loadedImageElements}`,
        `img_unique_sources=${uniqueImages.size}`,
        `img_decoded_rgba_estimate_bytes=${decodedImageBytesEstimate}`,
        `sidebar_img_elements=${sidebarImageElements}`,
        `sidebar_img_unique_sources=${uniqueSidebarImages.size}`,
        `sidebar_img_decoded_rgba_estimate_bytes=${sidebarDecodedImageBytesEstimate}`,
    ].join(';')
}

function collectFrontendSample() {
    const sections: string[] = []

    const browserMemory = collectBrowserMemoryProbe()
    if (browserMemory) {
        sections.push(`browser{${browserMemory}}`)
    }
    const now = Date.now()
    if (lastImageSampleAt === 0 || now - lastImageSampleAt >= IMAGE_SAMPLE_INTERVAL_MS) {
        sections.push(`images{${collectImageProbe()}}`)
        lastImageSampleAt = now
    }

    for (const [name, probe] of probes) {
        try {
            sections.push(`${sanitizeInline(name)}{${sanitizeInline(probe())}}`)
        } catch (error) {
            sections.push(`${sanitizeInline(name)}{probe_error=${sanitizeInline(String(error))}}`)
        }
    }

    return sections.join(' ')
}

async function writeFrontendSample() {
    if (sampleInFlight) {
        return
    }

    sampleInFlight = true
    try {
        await invoke('memory_watchdog_event', {
            event: 'frontend.sample',
            detail: collectFrontendSample(),
        })
    } catch (error) {
        console.warn('[memory-watchdog] failed to write frontend sample', error)
    } finally {
        sampleInFlight = false
    }
}

export function startMemoryWatchdogFrontendProbe() {
    if (!isTauri || started) {
        return
    }
    started = true

    memoryWatchdogEvent(
        'frontend.watchdog.start',
        `interval_ms=${FRONTEND_SAMPLE_INTERVAL_MS};image_interval_ms=${IMAGE_SAMPLE_INTERVAL_MS}`
    )
    void getMemoryWatchdogLogPath().then((path) => {
        if (path) {
            console.info(`[memory-watchdog] log: ${path}`)
        }
    })
    void writeFrontendSample()
    window.setInterval(() => {
        void writeFrontendSample()
    }, FRONTEND_SAMPLE_INTERVAL_MS)
}
