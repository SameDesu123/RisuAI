import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, request as nodeHttpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type TestHttpServer = {
    server: Server
    origin: string
}

type RisuServer = {
    child: ChildProcessWithoutNullStreams
    cwd: string
    origin: string
    logs: {
        stdout: string
        stderr: string
    }
}

type HttpResponse = {
    status: number
    headers: IncomingMessage['headers']
    body: string
}

const servers: Server[] = []
const risuServers: RisuServer[] = []

async function startHttpServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<TestHttpServer> {
    const server = createServer(handler)
    await new Promise<void>((resolveListen, rejectListen) => {
        server.once('error', rejectListen)
        server.listen(0, '127.0.0.1', () => {
            server.off('error', rejectListen)
            resolveListen()
        })
    })
    servers.push(server)
    const address = server.address()
    if (!address || typeof address === 'string') {
        throw new Error('Failed to start test HTTP server')
    }
    return {
        server,
        origin: `http://127.0.0.1:${address.port}`
    }
}

async function closeServer(server: Server) {
    if (!server.listening) {
        return
    }
    server.closeIdleConnections?.()
    server.closeAllConnections?.()
    await Promise.race([
        new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
                if (error) {
                    rejectClose(error)
                    return
                }
                resolveClose()
            })
        }),
        new Promise<void>((resolveClose) => setTimeout(resolveClose, 1_000))
    ])
}

async function startRisuServer(hubOrigin: string): Promise<RisuServer> {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const serverPath = resolve(repoRoot, 'server/node/server.cjs')
    const cwd = await mkdtemp(join(tmpdir(), 'risu-node-server-'))
    const portServer = await startHttpServer((_, res) => res.end('port holder'))
    const portAddress = portServer.server.address()
    if (!portAddress || typeof portAddress === 'string') {
        throw new Error('Failed to reserve Risu server port')
    }
    const port = portAddress.port
    await closeServer(portServer.server)
    servers.splice(servers.indexOf(portServer.server), 1)

    const logs = { stdout: '', stderr: '' }
    const child = spawn(process.execPath, [serverPath], {
        cwd,
        env: {
            ...process.env,
            PORT: String(port),
            RISU_HUB_URL: hubOrigin
        },
        stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', (chunk) => {
        logs.stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
        logs.stderr += chunk.toString()
    })

    const risuServer = {
        child,
        cwd,
        origin: `http://127.0.0.1:${port}`,
        logs
    }
    risuServers.push(risuServer)
    await waitForRisuServer(risuServer)
    return risuServer
}

async function waitForRisuServer(risuServer: RisuServer) {
    const deadline = Date.now() + 10_000
    let lastError: unknown
    while (Date.now() < deadline) {
        if (risuServer.child.exitCode !== null) {
            throw new Error(`Risu server exited early\n${risuServer.logs.stdout}\n${risuServer.logs.stderr}`)
        }
        try {
            const response = await requestText(`${risuServer.origin}/api/test_auth`)
            if (response.status >= 200 && response.status < 300) {
                return
            }
        } catch (error) {
            lastError = error
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
    throw new Error(`Timed out waiting for Risu server: ${String(lastError)}\n${risuServer.logs.stdout}\n${risuServer.logs.stderr}`)
}

async function requestText(url: string, options: {
    headers?: Record<string, string>
    method?: string
    body?: string
} = {}): Promise<HttpResponse> {
    return await new Promise<HttpResponse>((resolveRequest, rejectRequest) => {
        const req = nodeHttpRequest(url, {
            method: options.method || 'GET',
            headers: {
                connection: 'close',
                ...options.headers
            }
        }, (res) => {
            const chunks: Buffer[] = []
            res.on('data', (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            })
            res.on('end', () => {
                resolveRequest({
                    status: res.statusCode || 0,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString('utf-8')
                })
            })
        })
        req.setTimeout(3_000, () => {
            req.destroy(new Error(`Timed out requesting ${url}`))
        })
        req.on('error', rejectRequest)
        req.end(options.body)
    })
}

async function stopRisuServer(risuServer: RisuServer) {
    if (risuServer.child.exitCode === null) {
        risuServer.child.kill()
        await Promise.race([
            once(risuServer.child, 'exit'),
            new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
        ])
        if (risuServer.child.exitCode === null) {
            risuServer.child.kill('SIGKILL')
            await Promise.race([
                once(risuServer.child, 'exit'),
                new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
            ])
        }
    }
    risuServer.child.stdout.destroy()
    risuServer.child.stderr.destroy()
    await rm(risuServer.cwd, { recursive: true, force: true })
}

afterEach(async () => {
    await Promise.all(risuServers.splice(0).map((server) => stopRisuServer(server)))
    await Promise.all(servers.splice(0).map((server) => closeServer(server)))
}, 15_000)

describe('node hub proxy security', () => {
    it('rejects x-risu-node-path without reaching the supplied URL', async () => {
        let internalHits = 0
        const internalServer = await startHttpServer((_, res) => {
            internalHits += 1
            res.end('INTERNAL_SECRET_OK')
        })
        const hubServer = await startHttpServer((_, res) => {
            res.end('HUB_OK')
        })
        const risuServer = await startRisuServer(hubServer.origin)

        const response = await requestText(`${risuServer.origin}/hub-proxy/test`, {
            headers: {
                'x-risu-node-path': encodeURIComponent(`${internalServer.origin}/secret`)
            }
        })

        expect(response.status).toBe(400)
        expect(JSON.parse(response.body)).toEqual({
            error: 'Custom hub proxy targets are not allowed'
        })
        expect(internalHits).toBe(0)
    }, 15_000)

    it('continues proxying normal hub paths', async () => {
        let seenUrl = ''
        const hubServer = await startHttpServer((req, res) => {
            seenUrl = req.url || ''
            res.setHeader('x-hub-test', 'ok')
            res.end('HUB_OK')
        })
        const risuServer = await startRisuServer(hubServer.origin)

        const response = await requestText(`${risuServer.origin}/hub-proxy/hub/info/example?lang=ko`)

        expect(response.status).toBe(200)
        expect(response.headers['x-hub-test']).toBe('ok')
        expect(response.body).toBe('HUB_OK')
        expect(seenUrl).toBe('/hub/info/example?lang=ko')
    }, 15_000)
})
