export interface DeferredDisposalState {
    leases: number
    retiring?: boolean
    disposed?: boolean
}

export function leaseResource(state: DeferredDisposalState): boolean {
    if(state.retiring || state.disposed) return false
    state.leases++
    return true
}

export function retireResource(state: DeferredDisposalState, dispose: () => void): void {
    state.retiring = true
    disposeRetiredResource(state, dispose)
}

export function releaseResource(state: DeferredDisposalState, dispose: () => void): void {
    state.leases = Math.max(0, state.leases - 1)
    disposeRetiredResource(state, dispose)
}

function disposeRetiredResource(state: DeferredDisposalState, dispose: () => void): void {
    if(!state.retiring || state.leases !== 0 || state.disposed) return
    state.disposed = true
    dispose()
}
