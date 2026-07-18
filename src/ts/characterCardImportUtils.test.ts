import { Buffer } from 'buffer'
import { describe, expect, it } from 'vitest'
import { BoundedTaskQueue, decodeBase64Ascii } from './characterCardImportUtils'

const encoder = new TextEncoder()

describe('decodeBase64Ascii', () => {
    it('matches Buffer for padded, unpadded, wrapped, and URL-safe base64', () => {
        const lengths = [...Array.from({ length: 258 }, (_, index) => index), 4097]

        for(const length of lengths){
            const source = Uint8Array.from({ length }, (_, index) => (index * 131 + length * 17) % 256)
            const padded = Buffer.from(source).toString('base64')
            const inputs = [
                padded,
                padded.replace(/=+$/, ''),
                padded.replace(/(.{17})/g, '$1\n '),
                padded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
            ]

            for(const input of inputs){
                expect(decodeBase64Ascii(encoder.encode(input))).toEqual(new Uint8Array(Buffer.from(input, 'base64')))
            }
        }
    })
})

describe('BoundedTaskQueue', () => {
    it('limits the number of active tasks', async () => {
        const queue = new BoundedTaskQueue(3)
        let active = 0
        let maxActive = 0
        let completed = 0

        for(let index = 0; index < 9; index++){
            await queue.push(async () => {
                active += 1
                maxActive = Math.max(maxActive, active)
                await new Promise((resolve) => setTimeout(resolve, 1))
                active -= 1
                completed += 1
            })
        }

        await queue.done()
        expect(maxActive).toBe(3)
        expect(completed).toBe(9)
    })

    it('waits for already-started tasks before propagating a failure', async () => {
        const queue = new BoundedTaskQueue(2)
        const expectedError = new Error('asset write failed')
        let releaseSlowTask: () => void
        let slowTaskFinished = false
        let pushSettled = false

        await queue.push(async () => {
            await new Promise<void>((resolve) => {
                releaseSlowTask = resolve
            })
            slowTaskFinished = true
        })

        const failedPush = queue.push(async () => {
            throw expectedError
        })
        void failedPush.then(
            () => {
                pushSettled = true
            },
            () => {
                pushSettled = true
            }
        )

        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(pushSettled).toBe(false)
        releaseSlowTask!()

        await expect(failedPush).rejects.toBe(expectedError)
        expect(slowTaskFinished).toBe(true)
    })

    it('keeps failures that happen below the concurrency limit until done', async () => {
        const queue = new BoundedTaskQueue(3)
        const expectedError = new Error('single asset write failed')

        await queue.push(async () => {
            throw expectedError
        })

        await expect(queue.done()).rejects.toBe(expectedError)
    })

    it('does not start another task after observing a failure', async () => {
        const queue = new BoundedTaskQueue(3)
        const expectedError = new Error('asset write failed')
        let nextTaskStarted = false

        await queue.push(async () => {
            throw expectedError
        })
        await new Promise((resolve) => setTimeout(resolve, 0))

        await expect(queue.push(async () => {
            nextTaskStarted = true
        })).rejects.toBe(expectedError)
        expect(nextTaskStarted).toBe(false)
    })

    it('waits for background tasks before propagating a prior reader failure', async () => {
        const queue = new BoundedTaskQueue(3)
        const readerError = new Error('png reader failed')
        let releaseSave: () => void
        let saveFinished = false
        let doneSettled = false

        await queue.push(async () => {
            await new Promise<void>((resolve) => {
                releaseSave = resolve
            })
            saveFinished = true
        })
        const done = queue.done({ cause:readerError })
        void done.then(
            () => {
                doneSettled = true
            },
            () => {
                doneSettled = true
            }
        )

        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(doneSettled).toBe(false)
        releaseSave!()

        await expect(done).rejects.toBe(readerError)
        expect(saveFinished).toBe(true)
    })

    it('preserves both reader and asset-save failures', async () => {
        const queue = new BoundedTaskQueue(3)
        const readerError = new Error('png reader failed')
        const saveError = new Error('asset write failed')

        await queue.push(async () => {
            throw saveError
        })

        try {
            await queue.done({ cause:readerError })
            throw new Error('expected queue.done to fail')
        } catch (error) {
            expect(error).toBeInstanceOf(AggregateError)
            expect((error as AggregateError).errors).toEqual([readerError, saveError])
        }
    })
})
