/**
 * Watchdog Web Worker
 * 
 * Monitors the main thread's heartbeat and detects freezes.
 * Runs on a separate thread so it stays responsive even when the main thread is blocked.
 */

interface HeartbeatMessage {
    type: 'heartbeat'
    timestamp: number
}

interface PauseMessage {
    type: 'pause'
}

interface ResumeMessage {
    type: 'resume'
}

interface ActivityMessage {
    type: 'activity'
    stage: number
    description: string
}

interface ConfigMessage {
    type: 'config'
    freezeThresholdMs?: number
    checkIntervalMs?: number
}

type IncomingMessage = HeartbeatMessage | PauseMessage | ResumeMessage | ActivityMessage | ConfigMessage

interface FreezeDetectedMessage {
    type: 'freeze-detected'
    lastHeartbeat: number
    duration: number
    stage: number
    stageDescription: string
}

interface FreezeRecoveredMessage {
    type: 'freeze-recovered'
    freezeDuration: number
    stage: number
    stageDescription: string
}

type OutgoingMessage = FreezeDetectedMessage | FreezeRecoveredMessage

let lastHeartbeat = Date.now()
let paused = false
let frozen = false
let freezeStartTime = 0
let currentStage = -1
let currentStageDescription = ''
let checkIntervalMs = 1000
let freezeThresholdMs = 5000
let checkTimer: ReturnType<typeof setInterval> | null = null

function startChecking() {
    if (checkTimer !== null) return
    checkTimer = setInterval(checkHeartbeat, checkIntervalMs)
}

function stopChecking() {
    if (checkTimer !== null) {
        clearInterval(checkTimer)
        checkTimer = null
    }
}

function checkHeartbeat() {
    if (paused) return

    const now = Date.now()
    const elapsed = now - lastHeartbeat

    if (!frozen && elapsed >= freezeThresholdMs) {
        frozen = true
        freezeStartTime = lastHeartbeat

        const msg: FreezeDetectedMessage = {
            type: 'freeze-detected',
            lastHeartbeat,
            duration: elapsed,
            stage: currentStage,
            stageDescription: currentStageDescription
        }
        self.postMessage(msg)
    } else if (frozen && elapsed >= freezeThresholdMs) {
        // Still frozen - send updated duration
        const msg: FreezeDetectedMessage = {
            type: 'freeze-detected',
            lastHeartbeat,
            duration: elapsed,
            stage: currentStage,
            stageDescription: currentStageDescription
        }
        self.postMessage(msg)
    }
}

function handleHeartbeat(timestamp: number) {
    const now = Date.now()
    lastHeartbeat = timestamp || now

    if (frozen) {
        const freezeDuration = now - freezeStartTime
        frozen = false

        const msg: FreezeRecoveredMessage = {
            type: 'freeze-recovered',
            freezeDuration,
            stage: currentStage,
            stageDescription: currentStageDescription
        }
        self.postMessage(msg)
    }
}

self.onmessage = (e: MessageEvent<IncomingMessage>) => {
    const data = e.data

    switch (data.type) {
        case 'heartbeat':
            handleHeartbeat(data.timestamp)
            break

        case 'pause':
            paused = true
            // Reset freeze state - we don't count paused time
            if (frozen) {
                frozen = false
            }
            break

        case 'resume':
            paused = false
            lastHeartbeat = Date.now()
            break

        case 'activity':
            currentStage = data.stage
            currentStageDescription = data.description
            break

        case 'config':
            if (data.freezeThresholdMs !== undefined) {
                freezeThresholdMs = data.freezeThresholdMs
            }
            if (data.checkIntervalMs !== undefined) {
                checkIntervalMs = data.checkIntervalMs
                stopChecking()
                startChecking()
            }
            break
    }
}

startChecking()
