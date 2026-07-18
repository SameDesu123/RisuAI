export function decodeBase64Ascii(data: Uint8Array): Uint8Array {
    let validLength = 0
    let padding = 0

    for(const byte of data){
        if(byte === 61){
            padding += 1
            validLength += 1
        }
        else if((byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || (byte >= 48 && byte <= 57) || byte === 43 || byte === 47 || byte === 45 || byte === 95){
            validLength += 1
        }
    }

    const output = new Uint8Array(Math.max(0, Math.floor(validLength * 3 / 4) - padding))
    let buffer = 0
    let bits = 0
    let offset = 0

    for(const byte of data){
        if(byte === 61){
            break
        }

        let value = -1
        if(byte >= 65 && byte <= 90){
            value = byte - 65
        }
        else if(byte >= 97 && byte <= 122){
            value = byte - 71
        }
        else if(byte >= 48 && byte <= 57){
            value = byte + 4
        }
        else if(byte === 43 || byte === 45){
            value = 62
        }
        else if(byte === 47 || byte === 95){
            value = 63
        }
        else{
            continue
        }

        buffer = (buffer << 6) | value
        bits += 6
        if(bits >= 8){
            bits -= 8
            if(offset < output.length){
                output[offset] = (buffer >> bits) & 0xff
                offset += 1
            }
        }
    }

    return offset === output.length ? output : output.slice(0, offset)
}

/**
 * Adds backpressure while retaining every failure until the caller reaches the
 * final completion barrier. This prevents a fast rejection from disappearing
 * after it leaves the active-task set.
 */
export class BoundedTaskQueue {
    readonly #maxConcurrent: number
    readonly #pending = new Set<Promise<void>>()
    readonly #tasks: Promise<void>[] = []
    readonly #errors: unknown[] = []
    #cachedFailure:{ errorCount:number, cause:unknown }|undefined

    constructor(maxConcurrent: number) {
        if(!Number.isInteger(maxConcurrent) || maxConcurrent < 1){
            throw new RangeError('maxConcurrent must be a positive integer')
        }
        this.#maxConcurrent = maxConcurrent
    }

    async push(task: () => Promise<void>): Promise<void> {
        if(this.#errors.length > 0){
            await this.#settlePending()
            this.#throwErrors()
        }

        const promise = Promise.resolve().then(task)
        this.#tasks.push(promise)
        this.#pending.add(promise)
        void promise.then(
            () => this.#pending.delete(promise),
            (error) => {
                this.#pending.delete(promise)
                this.#errors.push(error)
                this.#cachedFailure = undefined
            }
        )

        if(this.#pending.size >= this.#maxConcurrent){
            await Promise.race(Array.from(this.#pending, (pending) => pending.then(
                () => undefined,
                () => undefined
            )))
            if(this.#errors.length > 0){
                await this.#settlePending()
                this.#throwErrors()
            }
        }
    }

    async done(priorFailure?:{ cause:unknown }): Promise<void> {
        await Promise.allSettled(this.#tasks)
        const taskFailure = this.#getFailure()
        if(priorFailure){
            if(taskFailure && taskFailure.cause !== priorFailure.cause){
                throw new AggregateError(
                    [priorFailure.cause, taskFailure.cause],
                    'Import processing and background tasks both failed'
                )
            }
            throw priorFailure.cause
        }
        if(taskFailure){
            throw taskFailure.cause
        }
    }

    async #settlePending(): Promise<void> {
        await Promise.allSettled(Array.from(this.#pending))
    }

    #throwErrors(): void {
        const failure = this.#getFailure()
        if(failure){
            throw failure.cause
        }
    }

    #getFailure():{ cause:unknown }|undefined {
        if(this.#errors.length === 0){
            return undefined
        }
        if(this.#cachedFailure?.errorCount === this.#errors.length){
            return this.#cachedFailure
        }
        this.#cachedFailure = {
            errorCount: this.#errors.length,
            cause: this.#errors.length === 1
                ? this.#errors[0]
                : new AggregateError(this.#errors, `Failed to run ${this.#errors.length} tasks`)
        }
        return this.#cachedFailure
    }
}
