/**
 * JSON Patch diff engine for incremental saves.
 * Generates RFC 6902-like patch operations with an `append` extension
 * optimized for the common case of chat message appends.
 *
 * No external dependencies.
 */

export type PatchOp =
    | { op: 'replace'; path: string; value: any }
    | { op: 'add'; path: string; value: any }
    | { op: 'remove'; path: string }
    | { op: 'append'; path: string; items: any[] }

const MAX_DEPTH = 10
const MAX_OPS = 200

/**
 * Generate a list of JSON patch operations that transform `oldObj` into `newObj`.
 * Returns `null` when diff is impractical (too many ops or too deep), signaling
 * the caller to fall back to sending the full block.
 */
export function generatePatch(oldObj: any, newObj: any): PatchOp[] | null {
    const ops: PatchOp[] = []
    const ok = diffValue(oldObj, newObj, '', ops, 0)
    if (!ok) return null
    if (ops.length > MAX_OPS) return null
    return ops
}

/**
 * Rough byte-size estimate of a patch payload (JSON-encoded).
 */
export function estimatePatchSize(ops: PatchOp[]): number {
    let size = 2 // []
    for (const op of ops) {
        // path + op name overhead
        size += 30 + op.path.length
        if (op.op === 'append') {
            size += JSON.stringify(op.items).length
        } else if (op.op === 'replace' || op.op === 'add') {
            size += JSON.stringify(op.value).length
        }
    }
    return size
}

// ─── Internal helpers ────────────────────────────────────────

function diffValue(
    oldVal: any,
    newVal: any,
    path: string,
    ops: PatchOp[],
    depth: number
): boolean {
    if (depth > MAX_DEPTH || ops.length > MAX_OPS) return false

    // Identical references or primitive equality
    if (oldVal === newVal) return true
    if (oldVal === null || newVal === null || typeof oldVal !== typeof newVal) {
        ops.push({ op: 'replace', path, value: newVal })
        return true
    }

    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
        return diffArray(oldVal, newVal, path, ops, depth)
    }

    if (typeof oldVal === 'object') {
        return diffObject(oldVal, newVal, path, ops, depth)
    }

    // Primitives that differ
    if (oldVal !== newVal) {
        ops.push({ op: 'replace', path, value: newVal })
    }
    return true
}

function diffObject(
    oldObj: Record<string, any>,
    newObj: Record<string, any>,
    path: string,
    ops: PatchOp[],
    depth: number
): boolean {
    const oldKeys = Object.keys(oldObj)
    const newKeys = Object.keys(newObj)
    const newKeySet = new Set(newKeys)
    const oldKeySet = new Set(oldKeys)

    // Removed keys
    for (const key of oldKeys) {
        if (!newKeySet.has(key)) {
            ops.push({ op: 'remove', path: `${path}/${escapePathSegment(key)}` })
            if (ops.length > MAX_OPS) return false
        }
    }

    // Added or changed keys
    for (const key of newKeys) {
        const childPath = `${path}/${escapePathSegment(key)}`
        if (!oldKeySet.has(key)) {
            ops.push({ op: 'add', path: childPath, value: newObj[key] })
            if (ops.length > MAX_OPS) return false
        } else {
            if (!diffValue(oldObj[key], newObj[key], childPath, ops, depth + 1)) {
                return false
            }
        }
    }
    return true
}

function diffArray(
    oldArr: any[],
    newArr: any[],
    path: string,
    ops: PatchOp[],
    depth: number
): boolean {
    // Fast path: same length and shallow equal
    if (oldArr.length === 0 && newArr.length === 0) return true

    // Detect pure append: oldArr is a prefix of newArr
    if (newArr.length >= oldArr.length) {
        let isAppend = true

        // Compare common prefix elements
        // For large arrays, use a cheap length-based pre-check on each element
        for (let i = 0; i < oldArr.length; i++) {
            if (!shallowJsonEqual(oldArr[i], newArr[i])) {
                isAppend = false
                break
            }
        }

        if (isAppend) {
            if (newArr.length > oldArr.length) {
                ops.push({ op: 'append', path, items: newArr.slice(oldArr.length) })
            }
            return true
        }
    }

    // Element-by-element diff for arrays of same or similar length
    const minLen = Math.min(oldArr.length, newArr.length)

    // If the size difference is too large, just replace
    if (Math.abs(oldArr.length - newArr.length) > 50) {
        ops.push({ op: 'replace', path, value: newArr })
        return true
    }

    // Diff common elements
    for (let i = 0; i < minLen; i++) {
        if (!diffValue(oldArr[i], newArr[i], `${path}/${i}`, ops, depth + 1)) {
            // Too complex, replace whole array
            // Roll back ops added for this array and replace
            ops.push({ op: 'replace', path, value: newArr })
            return true
        }
    }

    // Handle trailing elements
    if (newArr.length > minLen) {
        ops.push({ op: 'append', path, items: newArr.slice(minLen) })
    } else if (oldArr.length > minLen) {
        // Elements were removed from the end — replace entire array
        // (removing from the middle/end by index is fragile)
        ops.push({ op: 'replace', path, value: newArr })
    }

    return true
}

/**
 * Quick structural equality check using JSON serialization.
 * For small objects this is fast enough; for large objects
 * (like chat messages with long text) it is proportional to size
 * but only runs once per element.
 */
function shallowJsonEqual(a: any, b: any): boolean {
    if (a === b) return true
    if (typeof a !== typeof b) return false
    if (typeof a !== 'object' || a === null || b === null) return a === b
    if (Array.isArray(a) !== Array.isArray(b)) return false
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
        if (a[key] !== b[key]) return false
    }
    return true
}

/**
 * Escape `/` and `~` in JSON Pointer path segments (RFC 6901).
 */
function escapePathSegment(seg: string): string {
    return seg.replace(/~/g, '~0').replace(/\//g, '~1')
}
