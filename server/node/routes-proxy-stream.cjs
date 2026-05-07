const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { proxyStreamConfig } = require('./config.cjs');

function createProxyStreamHandlers(arg) {
    const { state, authHelpers } = arg;
    const { checkProxyAuth, isAuthorizedProxyRequest } = authHelpers;
    const proxyStreamJobs = state.proxyStreamJobs;

    function normalizeProxyStreamTimeoutMs(timeoutMs) {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            return proxyStreamConfig.defaultTimeoutMs;
        }
        const parsed = Math.max(1, Math.floor(timeoutMs));
        return Math.min(proxyStreamConfig.maxTimeoutMs, parsed);
    }

    function normalizeHeartbeatSec(heartbeatSec) {
        if (!Number.isFinite(heartbeatSec)) {
            return proxyStreamConfig.defaultHeartbeatSec;
        }
        const parsed = Math.floor(heartbeatSec);
        return Math.min(proxyStreamConfig.heartbeatMaxSec, Math.max(proxyStreamConfig.heartbeatMinSec, parsed));
    }

    function isPrivateIPv4Host(hostname) {
        const parts = hostname.split('.');
        if (parts.length !== 4) {
            return false;
        }
        const octets = parts.map((part) => Number.parseInt(part, 10));
        if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
            return false;
        }
        const [a, b] = octets;
        if (a === 10) {
            return true;
        }
        if (a === 127) {
            return true;
        }
        if (a === 0) {
            return true;
        }
        if (a === 192 && b === 168) {
            return true;
        }
        if (a === 172 && b >= 16 && b <= 31) {
            return true;
        }
        if (a === 169 && b === 254) {
            return true;
        }
        return false;
    }

    function isLocalNetworkHost(hostname) {
        if (typeof hostname !== 'string' || hostname.trim() === '') {
            return false;
        }

        const normalizedHost = hostname.toLowerCase().replace(/\.$/, '').split('%')[0];
        if (normalizedHost === 'localhost' || normalizedHost === '::1' || normalizedHost.endsWith('.local')) {
            return true;
        }

        if (net.isIP(normalizedHost) === 4) {
            return isPrivateIPv4Host(normalizedHost);
        }

        if (net.isIP(normalizedHost) === 6) {
            if (normalizedHost.startsWith('::ffff:')) {
                const mapped = normalizedHost.substring(7);
                return net.isIP(mapped) === 4 && isPrivateIPv4Host(mapped);
            }
            if (normalizedHost.startsWith('fc') || normalizedHost.startsWith('fd')) {
                return true;
            }
            if (/^fe[89ab]/.test(normalizedHost)) {
                return true;
            }
            return normalizedHost === '::1';
        }

        return false;
    }

    function sanitizeTargetUrl(raw) {
        if (typeof raw !== 'string' || raw.trim() === '') {
            return null;
        }
        try {
            const parsed = new URL(raw);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return null;
            }
            if (!isLocalNetworkHost(parsed.hostname)) {
                return null;
            }
            parsed.username = '';
            parsed.password = '';
            return parsed.toString();
        } catch {
            return null;
        } // lgtm[js/request-forgery]
    }

    function normalizeForwardHeaders(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            return {};
        }
        const normalized = {};
        for (const [key, value] of Object.entries(input)) {
            if (typeof key !== 'string') {
                continue;
            }
            if (typeof value === 'string') {
                normalized[key] = value;
            }
        }
        delete normalized['risu-auth'];
        delete normalized['risu-timeout-ms'];
        delete normalized['host'];
        delete normalized['connection'];
        delete normalized['content-length'];
        return normalized;
    }

    function normalizeProxyResponseHeaders(headers) {
        const normalized = {};
        for (const [key, value] of Object.entries(headers || {})) {
            if (value === undefined) {
                continue;
            }
            normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        }
        return normalized;
    }

    function requestLocalTargetStream(targetUrl, arg) {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(targetUrl);
            const client = parsedUrl.protocol === 'https:' ? https : http;
            const headers = normalizeForwardHeaders(arg.headers);
            if (!headers['host']) {
                headers['host'] = parsedUrl.host;
            }
            if (arg.bodyBuffer && !headers['content-length']) {
                headers['content-length'] = String(arg.bodyBuffer.length);
            }

            let settled = false;
            let cleanupAbort = () => {};
            const finishReject = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanupAbort();
                reject(error);
            };

            const req = client.request(parsedUrl, {
                method: arg.method,
                headers
            }, (res) => {
                if (settled) {
                    res.destroy();
                    return;
                }
                settled = true;
                cleanupAbort();
                resolve({
                    status: res.statusCode || 502,
                    headers: normalizeProxyResponseHeaders(res.headers),
                    body: res
                });
            });

            req.on('error', (error) => {
                finishReject(error);
            });

            req.setTimeout(arg.timeoutMs, () => {
                req.destroy(new Error(`Upstream request timed out after ${arg.timeoutMs}ms`));
            });

            if (arg.signal) {
                const onAbort = () => {
                    const abortError = new Error('Proxy stream job aborted');
                    abortError.name = 'AbortError';
                    req.destroy(abortError);
                };
                if (arg.signal.aborted) {
                    onAbort();
                    return;
                }
                arg.signal.addEventListener('abort', onAbort, { once: true });
                cleanupAbort = () => arg.signal.removeEventListener('abort', onAbort);
            }

            if (arg.bodyBuffer && arg.method !== 'GET' && arg.method !== 'HEAD') {
                req.write(arg.bodyBuffer);
            }
            req.end();
        });
    }

    function createProxyStreamJob(arg) {
        const jobId = crypto.randomUUID();
        const timeoutMs = normalizeProxyStreamTimeoutMs(Number(arg.timeoutMs));
        const heartbeatSec = normalizeHeartbeatSec(arg.heartbeatSec);
        const controller = new AbortController();
        const createdAt = Date.now();
        const job = {
            id: jobId,
            createdAt,
            updatedAt: createdAt,
            done: false,
            cleanupAt: 0,
            clients: new Set(),
            pendingEvents: [],
            pendingBytes: 0,
            abortController: controller,
            deadlineAt: createdAt + timeoutMs,
            heartbeatSec,
            timeoutMs // lgtm[js/request-forgery]
        };
        proxyStreamJobs.set(jobId, job);
        return job;
    }

    function pushJobEvent(job, event) {
        job.updatedAt = Date.now();
        const text = JSON.stringify(event);
        if (job.clients.size === 0) {
            job.pendingEvents.push(text);
            job.pendingBytes += Buffer.byteLength(text);
            while (
                job.pendingEvents.length > proxyStreamConfig.maxPendingEvents
                || job.pendingBytes > proxyStreamConfig.maxPendingBytes
            ) {
                const removed = job.pendingEvents.shift();
                if (!removed) {
                    break;
                }
                job.pendingBytes -= Buffer.byteLength(removed);
            }
            return;
        }
        for (const client of job.clients) {
            if (client.readyState === client.OPEN) {
                client.send(text);
            }
        }
    }

    function markJobDone(job) {
        if (job.done) {
            return;
        }
        job.done = true;
        job.cleanupAt = Date.now() + proxyStreamConfig.doneGraceMs;
    }

    function cleanupJob(jobId) {
        const job = proxyStreamJobs.get(jobId);
        if (!job) {
            return;
        }
        for (const client of job.clients) {
            try {
                client.close();
            } catch {
                // ignore
            }
        }
        proxyStreamJobs.delete(jobId);
    }

    async function runProxyStreamJob(job, arg) {
        const targetUrl = sanitizeTargetUrl(arg.targetUrl);
        if (!targetUrl) {
            pushJobEvent(job, {
                type: 'error',
                status: 400,
                message: 'Blocked non-local target URL'
            });
            markJobDone(job);
            return;
        }

        const headers = normalizeForwardHeaders(arg.headers);
        if (!headers['x-forwarded-for']) {
            headers['x-forwarded-for'] = arg.clientIp;
        }
        const bodyBuffer = arg.bodyBase64 ? Buffer.from(arg.bodyBase64, 'base64') : undefined;

        try {
            const upstreamResponse = await requestLocalTargetStream(targetUrl, {
                method: arg.method,
                headers,
                bodyBuffer,
                timeoutMs: job.timeoutMs,
                signal: job.abortController.signal
            });

            const filteredHeaders = {};
            for (const [key, value] of Object.entries(upstreamResponse.headers)) {
                if (key === 'content-security-policy' || key === 'content-security-policy-report-only' || key === 'clear-site-data') {
                    continue;
                }
                filteredHeaders[key] = value;
            }

            pushJobEvent(job, {
                type: 'upstream_headers',
                status: upstreamResponse.status,
                headers: filteredHeaders
            });

            if (upstreamResponse.body) {
                for await (const value of upstreamResponse.body) {
                    if (job.abortController.signal.aborted) {
                        break;
                    }
                    if (value && value.length > 0) {
                        pushJobEvent(job, {
                            type: 'chunk',
                            dataBase64: Buffer.from(value).toString('base64')
                        });
                    }
                }
            }
            pushJobEvent(job, { type: 'done' });
            markJobDone(job);
        } catch (error) {
            const message = error?.name === 'AbortError' ? 'Proxy stream job aborted' : `${error}`;
            pushJobEvent(job, {
                type: 'error',
                status: 504,
                message
            });
            markJobDone(job);
        }
    }

    function registerProxyStreamRoutes(app, authenticatedRouteLimiter) {
        app.post('/proxy-stream-jobs', authenticatedRouteLimiter, async (req, res) => {
            if (!await checkProxyAuth(req, res)) {
                return;
            }

            const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
            const encodedUrl = encodeURIComponent(rawUrl);
            const url = sanitizeTargetUrl(decodeURIComponent(encodedUrl));
            if (!url) {
                res.status(400).send({ error: 'Invalid target URL. Only local/private network http(s) endpoints are allowed.' });
                return;
            }

            const method = typeof req.body?.method === 'string' ? req.body.method.toUpperCase() : 'POST';
            if (!['POST', 'GET', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
                res.status(400).send({ error: 'Invalid method' });
                return;
            }

            const bodyBase64 = typeof req.body?.bodyBase64 === 'string' ? req.body.bodyBase64 : '';
            if (bodyBase64.length > proxyStreamConfig.maxBodyBase64Bytes) {
                res.status(413).send({ error: 'Request body too large' });
                return;
            }
            if (proxyStreamJobs.size >= proxyStreamConfig.maxActiveJobs) {
                res.status(429).send({ error: 'Too many active stream jobs. Retry shortly.' });
                return;
            }
            const headers = normalizeForwardHeaders(req.body?.headers);
            const heartbeatSec = normalizeHeartbeatSec(Number(req.body?.heartbeatSec));
            const job = createProxyStreamJob({
                heartbeatSec,
                timeoutMs: req.body?.timeoutMs
            });

            void runProxyStreamJob(job, {
                targetUrl: url,
                headers,
                method,
                bodyBase64,
                clientIp: req.ip
            });

            res.send({
                jobId: job.id,
                heartbeatSec: job.heartbeatSec
            });
        });

        app.delete('/proxy-stream-jobs/:jobId', authenticatedRouteLimiter, async (req, res) => {
            if (!await checkProxyAuth(req, res)) {
                return;
            }
            const job = proxyStreamJobs.get(req.params.jobId);
            if (!job) {
                res.send({ success: true });
                return;
            }
            job.abortController.abort();
            markJobDone(job);
            cleanupJob(job.id);
            res.send({ success: true });
        });
    }

    function setupProxyStreamWebSocket(server) {
        const wsServer = new WebSocketServer({ noServer: true });
        server.on('upgrade', async (req, socket, head) => {
            try {
                const reqUrl = new URL(req.url, `http://${req.headers.host}`);
                if (!reqUrl.pathname.startsWith('/proxy-stream-jobs/') || !reqUrl.pathname.endsWith('/ws')) {
                    socket.destroy();
                    return;
                }

                const auth = reqUrl.searchParams.get('risu-auth') || req.headers['risu-auth'];
                if (!await isAuthorizedProxyRequest({ headers: { 'risu-auth': auth } })) {
                    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                    socket.destroy();
                    return;
                }

                const pathParts = reqUrl.pathname.split('/').filter(Boolean);
                const jobId = pathParts.length >= 3 ? pathParts[1] : '';
                const job = proxyStreamJobs.get(jobId);
                if (!job) {
                    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                    socket.destroy();
                    return;
                }

                wsServer.handleUpgrade(req, socket, head, (ws) => {
                    wsServer.emit('connection', ws, req, jobId);
                });
            } catch {
                socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                socket.destroy();
            }
        });

        wsServer.on('connection', (ws, _req, jobId) => {
            const job = proxyStreamJobs.get(jobId);
            if (!job) {
                ws.close();
                return;
            }

            job.clients.add(ws);
            ws.send(JSON.stringify({ type: 'job_accepted', jobId }));
            for (const event of job.pendingEvents) {
                ws.send(event);
            }
            job.pendingEvents = [];
            job.pendingBytes = 0;

            const pingTimer = setInterval(() => {
                if (ws.readyState !== ws.OPEN) {
                    return;
                }
                ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
            }, job.heartbeatSec * 1000);

            ws.on('close', () => {
                clearInterval(pingTimer);
                const currentJob = proxyStreamJobs.get(jobId);
                if (!currentJob) {
                    return;
                }
                currentJob.clients.delete(ws);
                if (currentJob.done && currentJob.clients.size === 0) {
                    cleanupJob(jobId);
                }
            });

            ws.on('error', () => {
                clearInterval(pingTimer);
            });
        });
    }

    function startProxyStreamGc() {
        return setInterval(() => {
            const now = Date.now();
            for (const [jobId, job] of proxyStreamJobs.entries()) {
                if (!job.done && now >= job.deadlineAt && !job.abortController.signal.aborted) {
                    job.abortController.abort();
                }
                if (job.done && job.clients.size === 0 && job.cleanupAt > 0 && now >= job.cleanupAt) {
                    cleanupJob(jobId);
                    continue;
                }
                if (!job.done && now - job.updatedAt > Math.max(proxyStreamConfig.defaultTimeoutMs, job.timeoutMs * 2)) {
                    cleanupJob(jobId);
                }
            }
        }, proxyStreamConfig.gcIntervalMs);
    }

    return {
        registerProxyStreamRoutes,
        setupProxyStreamWebSocket,
        startProxyStreamGc,
    };
}

module.exports = {
    createProxyStreamHandlers,
};
