/**
 * Watchdog Manager
 * 
 * Main-thread side of the freeze detection system.
 * Sends periodic heartbeats to the watchdog worker and handles freeze events.
 */

const HEARTBEAT_INTERVAL_MS = 1000
const FREEZE_THRESHOLD_MS = 5000
const RESUME_GRACE_PERIOD_MS = 3000

export const watchdogState = $state({
    frozen: false,
    freezeDuration: 0,
    stage: -1,
    stageDescription: '',
    recovered: false,
    lastFreezeDuration: 0,
    initialized: false,
})

let worker: Worker | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let abortCallback: (() => void) | null = null
let resumeGraceTimer: ReturnType<typeof setTimeout> | null = null

export function registerAbortCallback(callback: () => void) {
    abortCallback = callback
}

export function unregisterAbortCallback() {
    abortCallback = null
}

export function triggerAbort() {
    if (abortCallback) {
        abortCallback()
    }
}

function sendHeartbeat() {
    if (worker) {
        worker.postMessage({ type: 'heartbeat', timestamp: Date.now() })
    }
}

export function reportActivity(stage: number, description: string) {
    watchdogState.stage = stage
    watchdogState.stageDescription = description
    if (worker) {
        worker.postMessage({ type: 'activity', stage, description })
    }
}

export function reportIdle() {
    watchdogState.stage = -1
    watchdogState.stageDescription = ''
    if (worker) {
        worker.postMessage({ type: 'activity', stage: -1, description: '' })
    }
}

function handleWorkerMessage(e: MessageEvent) {
    const data = e.data

    switch (data.type) {
        case 'freeze-detected':
            watchdogState.frozen = true
            watchdogState.freezeDuration = data.duration
            watchdogState.stage = data.stage
            watchdogState.stageDescription = data.stageDescription
            watchdogState.recovered = false
            break

        case 'freeze-recovered':
            watchdogState.frozen = false
            watchdogState.recovered = true
            watchdogState.lastFreezeDuration = data.freezeDuration
            watchdogState.stage = data.stage
            watchdogState.stageDescription = data.stageDescription
            watchdogState.freezeDuration = 0
            break
    }
}

function handleVisibilityChange() {
    if (!worker) return

    if (document.hidden) {
        worker.postMessage({ type: 'pause' })
        if (heartbeatTimer !== null) {
            clearInterval(heartbeatTimer)
            heartbeatTimer = null
        }
    } else {
        // Grace period after returning from background
        if (resumeGraceTimer) {
            clearTimeout(resumeGraceTimer)
        }
        resumeGraceTimer = setTimeout(() => {
            if (worker) {
                worker.postMessage({ type: 'resume' })
            }
            sendHeartbeat()
            heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
            resumeGraceTimer = null
        }, RESUME_GRACE_PERIOD_MS)
    }
}

export function dismissFreezeNotification() {
    watchdogState.recovered = false
    watchdogState.lastFreezeDuration = 0
}

export function initWatchdog() {
    if (watchdogState.initialized) return

    try {
        worker = new Worker(
            new URL('./watchdog.worker.ts', import.meta.url),
            { type: 'module' }
        )

        worker.onmessage = handleWorkerMessage
        worker.onerror = (e) => {
            console.error('[Watchdog] Worker error:', e)
        }

        worker.postMessage({
            type: 'config',
            freezeThresholdMs: FREEZE_THRESHOLD_MS,
            checkIntervalMs: HEARTBEAT_INTERVAL_MS,
        })

        heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
        sendHeartbeat()

        document.addEventListener('visibilitychange', handleVisibilityChange)

        watchdogState.initialized = true
    } catch (e) {
        console.warn('[Watchdog] Failed to initialize:', e)
    }
}

export function destroyWatchdog() {
    if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
    }
    if (resumeGraceTimer) {
        clearTimeout(resumeGraceTimer)
        resumeGraceTimer = null
    }
    if (worker) {
        worker.terminate()
        worker = null
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    watchdogState.initialized = false
    watchdogState.frozen = false
    watchdogState.recovered = false
}
