const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const net = require('net');
const htmlparser = require('node-html-parser');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const fs = require('fs/promises')
const crypto = require('crypto')
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
app.use(express.static(path.join(process.cwd(), 'dist'), {index: false}));
app.use(express.json({ limit: '100mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));
app.use(express.text({ limit: '100mb' }));
const {pipeline} = require('stream/promises')
const https = require('https');
const zlib = require('zlib');
const sslPath = path.join(process.cwd(), 'server/node/ssl/certificate');
const hubURL = 'https://sv.risuai.xyz'; 
const openid = require('openid-client');

let password = ''
let knownPublicKeysHashes = new Set()

const savePath = path.join(process.cwd(), "save")
if(!existsSync(savePath)){
    mkdirSync(savePath)
}

const passwordPath = path.join(process.cwd(), 'save', '__password')
if(existsSync(passwordPath)){
    password = readFileSync(passwordPath, 'utf-8')
}

const knownPublicKeysPath = path.join(process.cwd(), 'save', '__known_public_key_hashes.json')
if(existsSync(knownPublicKeysPath)){
    const knownPublicKeysRaw = readFileSync(knownPublicKeysPath, 'utf-8');
    knownPublicKeysHashes = new Set(JSON.parse(knownPublicKeysRaw));
}

const authCodePath = path.join(process.cwd(), 'save', '__authcode')
const dbBlocksPath = path.join(savePath, '__dbblocks')
const hexRegex = /^[0-9a-fA-F]+$/;
// Safe block name: alphanumeric, hyphens, underscores only
const safeBlockNameRegex = /^[a-zA-Z0-9_-]+$/;
const PROXY_STREAM_DEFAULT_TIMEOUT_MS = 600000;
const PROXY_STREAM_MAX_TIMEOUT_MS = 3600000;
const PROXY_STREAM_DEFAULT_HEARTBEAT_SEC = 15;
const PROXY_STREAM_HEARTBEAT_MIN_SEC = 5;
const PROXY_STREAM_HEARTBEAT_MAX_SEC = 60;
const PROXY_STREAM_GC_INTERVAL_MS = 60000;
const PROXY_STREAM_DONE_GRACE_MS = 30000;
const PROXY_STREAM_MAX_ACTIVE_JOBS = 64;
const PROXY_STREAM_MAX_PENDING_EVENTS = 512;
const PROXY_STREAM_MAX_PENDING_BYTES = 2 * 1024 * 1024;
const PROXY_STREAM_MAX_BODY_BASE64_BYTES = 8 * 1024 * 1024;
const proxyStreamJobs = new Map();
const authenticatedRouteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please retry shortly.' }
});
const authRouteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please retry shortly.' }
});
const loginRouteLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait and try again later.' },
    validate: { trustProxy: false, xForwardedForHeader: false }
});
function isHex(str) {
    return hexRegex.test(str.toUpperCase().trim()) || str === '__password';
}

async function hashJSON(json){
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(json));
    return hash.digest('hex');
}

function isAuthorizedRequest(req) {
    const authHeader = normalizeAuthHeader(req.headers['risu-auth']);
    return !!authHeader && authHeader.trim() === password.trim();
}

function normalizeAuthHeader(authHeader) {
    if (Array.isArray(authHeader)) {
        return authHeader[0] || '';
    }
    return typeof authHeader === 'string' ? authHeader : '';
}

async function isAuthorizedJwtHeader(authHeader) {
    try {
        const normalized = normalizeAuthHeader(authHeader);
        if (!normalized) {
            return false;
        }

        const [
            jsonHeaderB64,
            jsonPayloadB64,
            signatureB64,
        ] = normalized.split('.');

        if (!jsonHeaderB64 || !jsonPayloadB64 || !signatureB64) {
            return false;
        }

        const jsonHeader = JSON.parse(Buffer.from(jsonHeaderB64, 'base64url').toString('utf-8'));
        const jsonPayload = JSON.parse(Buffer.from(jsonPayloadB64, 'base64url').toString('utf-8'));
        const signature = Buffer.from(signatureB64, 'base64url');

        const now = Math.floor(Date.now() / 1000);
        if (jsonPayload.exp < now) {
            return false;
        }

        const pubKeyHash = await hashJSON(jsonPayload.pub);
        if (!knownPublicKeysHashes.has(pubKeyHash)) {
            return false;
        }

        if (jsonHeader.alg !== 'ES256') {
            return false;
        }

        return await crypto.subtle.verify(
            {
                name: 'ECDSA',
                hash: { name: 'SHA-256' },
            },
            await crypto.subtle.importKey(
                'jwk',
                jsonPayload.pub,
                {
                    name: 'ECDSA',
                    namedCurve: 'P-256',
                },
                false,
                ['verify']
            ),
            signature,
            Buffer.from(`${jsonHeaderB64}.${jsonPayloadB64}`)
        );
    } catch {
        return false;
    }
}

async function isAuthorizedProxyRequest(req) {
    if (isAuthorizedRequest(req)) {
        return true;
    }
    return await isAuthorizedJwtHeader(req.headers['risu-auth']);
}

async function checkProxyAuth(req, res) {
    if (isAuthorizedRequest(req)) {
        return true;
    }
    return await checkAuth(req, res);
}

function getRequestTimeoutMs(timeoutHeader) {
    const raw = Array.isArray(timeoutHeader) ? timeoutHeader[0] : timeoutHeader;
    if (!raw) {
        return null;
    }
    const timeoutMs = Number.parseInt(raw, 10);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return null;
    }
    return timeoutMs;
}

function createTimeoutController(timeoutMs) {
    if (!timeoutMs) {
        return {
            signal: undefined,
            cleanup: () => {}
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return {
        signal: controller.signal,
        cleanup: () => clearTimeout(timer)
    };
}

function normalizeProxyStreamTimeoutMs(timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return PROXY_STREAM_DEFAULT_TIMEOUT_MS;
    }
    const parsed = Math.max(1, Math.floor(timeoutMs));
    return Math.min(PROXY_STREAM_MAX_TIMEOUT_MS, parsed);
}

function normalizeHeartbeatSec(heartbeatSec) {
    if (!Number.isFinite(heartbeatSec)) {
        return PROXY_STREAM_DEFAULT_HEARTBEAT_SEC;
    }
    const parsed = Math.floor(heartbeatSec);
    return Math.min(PROXY_STREAM_HEARTBEAT_MAX_SEC, Math.max(PROXY_STREAM_HEARTBEAT_MIN_SEC, parsed));
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
            job.pendingEvents.length > PROXY_STREAM_MAX_PENDING_EVENTS
            || job.pendingBytes > PROXY_STREAM_MAX_PENDING_BYTES
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
    job.cleanupAt = Date.now() + PROXY_STREAM_DONE_GRACE_MS;
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

async function forwardUpstreamResponse(originalResponse, res) {
    const head = new Headers(originalResponse.headers);
    head.delete('content-security-policy');
    head.delete('content-security-policy-report-only');
    head.delete('clear-site-data');
    head.delete('Cache-Control');
    head.delete('Content-Encoding');

    const contentType = (head.get('content-type') || '').toLowerCase();
    const isSSE = contentType.includes('text/event-stream');
    if (isSSE) {
        head.set('Cache-Control', 'no-cache, no-transform');
        head.set('Connection', 'keep-alive');
        head.set('X-Accel-Buffering', 'no');
        head.delete('content-length');
    }

    const headObj = {};
    for (const [k, v] of head) {
        headObj[k] = v;
    }

    res.header(headObj);
    res.status(originalResponse.status);

    if (!originalResponse.body) {
        res.end();
        return;
    }

    if (!isSSE) {
        await pipeline(originalResponse.body, res);
        return;
    }

    const reader = originalResponse.body.getReader();

    const onClose = () => {
        reader.cancel().catch(() => {});
    };
    res.on('close', onClose);

    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    try {
        while (!res.writableEnded) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (value && value.length > 0) {
                res.write(Buffer.from(value));
            }
        }
    } catch (error) {
        if (!res.writableEnded) {
            throw error;
        }
    } finally {
        res.off('close', onClose);
        if (!res.writableEnded) {
            res.end();
        }
    }
}

app.get('/', async (req, res, next) => {

    const clientIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || 'Unknown IP';
    const timestamp = new Date().toISOString();
    console.log(`[Server] ${timestamp} | Connection from: ${clientIP}`);
    
    try {
        const mainIndex = await fs.readFile(path.join(process.cwd(), 'dist', 'index.html'))
        const root = htmlparser.parse(mainIndex)
        const head = root.querySelector('head')
        head.innerHTML = `<script>globalThis.__NODE__ = true</script>` + head.innerHTML
        
        res.send(root.toString())
    } catch (error) {
        console.log(error)
        next(error)
    }
})

async function checkAuth(req, res, returnOnlyStatus = false){
    try {
        const authHeader = normalizeAuthHeader(req.headers['risu-auth']);

        if(!authHeader){
            console.log('No auth header')
            if(returnOnlyStatus){
                return false;
            }
            res.status(400).send({
                error:'No auth header'
            });
            return false
        }


        //jwt token
        const [
            jsonHeaderB64,
            jsonPayloadB64,
            signatureB64,
        ] = authHeader.split('.');

        //alg, typ
        const jsonHeader = JSON.parse(Buffer.from(jsonHeaderB64, 'base64url').toString('utf-8'));

        //iat, exp, pub
        const jsonPayload = JSON.parse(Buffer.from(jsonPayloadB64, 'base64url').toString('utf-8'));

        //signature
        const signature = Buffer.from(signatureB64, 'base64url');

        
        //check expiration
        const now = Math.floor(Date.now() / 1000);
        if(jsonPayload.exp < now){
            console.log('Token expired')
            if(returnOnlyStatus){
                return false;
            }
            res.status(400).send({
                error:'Token Expired'
            });
            return false
        }

        //check if public key is known
        const pubKeyHash = await hashJSON(jsonPayload.pub)
        if(!knownPublicKeysHashes.has(pubKeyHash)){
            console.log('Unknown public key')
            if(returnOnlyStatus){
                return false;
            }
            res.status(400).send({
                error:'Unknown Public Key'
            });
            return false
        }

        //check signature
        if(jsonHeader.alg !== "ES256"){
            //only support ECDSA for now
            console.log('Unsupported algorithm')
            if(returnOnlyStatus){
                return false;
            }
            res.status(400).send({
                error:'Unsupported Algorithm'
            });
            return false
        }

        const isValid = await crypto.subtle.verify(
            {
                name: 'ECDSA',
                hash: {name: 'SHA-256'},
            },
            await crypto.subtle.importKey(
                'jwk',
                jsonPayload.pub,
                {
                    name: 'ECDSA',
                    namedCurve: 'P-256',
                },
                false,
                ['verify']
            ),
            signature,
            Buffer.from(`${jsonHeaderB64}.${jsonPayloadB64}`)
        );

        if(!isValid){
            console.log('Invalid signature')
            if(returnOnlyStatus){
                return false;
            }
            res.status(400).send({
                error:'Invalid Signature'
            });
            return false
        }
        
        return true   
    } catch (error) {
        console.log(error)
        if(returnOnlyStatus){
            return false;
        }
        res.status(500).send({
            error:'Internal Server Error'
        });
        return false
    }
}

const reverseProxyFunc = async (req, res, next) => {
    if(!await checkProxyAuth(req, res)){
        return;
    }
    
    const urlParam = req.headers['risu-url'] ? decodeURIComponent(req.headers['risu-url']) : req.query.url;

    if (!urlParam) {
        res.status(400).send({
            error:'URL has no param'
        });
        return;
    }
    const header = req.headers['risu-header'] ? JSON.parse(decodeURIComponent(req.headers['risu-header'])) : req.headers;
    if(!header['x-forwarded-for']){
        header['x-forwarded-for'] = req.ip
    }

    if(req.headers['authorization']?.startsWith('X-SERVER-REGISTER')){
        if(!existsSync(authCodePath)){
            delete header['authorization']
        }
        else{
            const authCode = await fs.readFile(authCodePath, {
                encoding: 'utf-8'
            })
            header['authorization'] = `Bearer ${authCode}`
        }
    }

    // Pre-commit 200 response and start keepalive to prevent
    // iPad WebKit's 60-second network timeout.
    // Keepalive newlines are harmless: JSON.parse ignores leading whitespace,
    // and SSE parsers skip empty lines.
    res.writeHead(200, {
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    const keepAliveInterval = setInterval(() => {
        if (!res.writableEnded) {
            res.write('\n');
        }
    }, 15000);

    const cleanupInterval = () => {
        clearInterval(keepAliveInterval);
    };

    res.on('close', cleanupInterval);

    const timeoutMs = getRequestTimeoutMs(req.headers['risu-timeout-ms']);
    const timeout = createTimeoutController(timeoutMs);
    let originalResponse;
    try {
        // make request to original server
        originalResponse = await fetch(urlParam, {
            method: req.method,
            headers: header,
            body: JSON.stringify(req.body),
            signal: timeout.signal
        });

        const contentType = originalResponse.headers.get('content-type') || '';
        const isEventStream = contentType.includes('text/event-stream');

        if (!isEventStream) {
            cleanupInterval();
        }

        // Stream the upstream response body to client (preserves SSE format)
        await pipeline(originalResponse.body, res);

        cleanupInterval();
    }
    catch (err) {
        cleanupInterval();
        if (err?.name === 'AbortError') {
            if (!res.headersSent) {
                res.status(504).send({
                    error: timeoutMs
                        ? `Proxy request timed out after ${timeoutMs}ms`
                        : 'Proxy request aborted'
                });
            } else {
                res.end();
            }
            return;
        }
        try {
            res.write(JSON.stringify({ error: err.message || 'Proxy request failed' }));
            res.end();
        } catch (writeErr) {
            // Client already disconnected, nothing to do
        }
    } finally {
        timeout.cleanup();
    }
}

const reverseProxyFunc_get = async (req, res, next) => {
    if(!await checkProxyAuth(req, res)){
        return;
    }
    
    const urlParam = req.headers['risu-url'] ? decodeURIComponent(req.headers['risu-url']) : req.query.url;

    if (!urlParam) {
        res.status(400).send({
            error:'URL has no param'
        });
        return;
    }
    const header = req.headers['risu-header'] ? JSON.parse(decodeURIComponent(req.headers['risu-header'])) : req.headers;
    if(!header['x-forwarded-for']){
        header['x-forwarded-for'] = req.ip
    }
    const timeoutMs = getRequestTimeoutMs(req.headers['risu-timeout-ms']);
    const timeout = createTimeoutController(timeoutMs);
    let originalResponse;
    try {
        // make request to original server
        originalResponse = await fetch(urlParam, {
            method: 'GET',
            headers: header,
            signal: timeout.signal
        });
        // get response body as stream
        const originalBody = originalResponse.body;
        // get response headers
        const head = new Headers(originalResponse.headers);
        head.delete('content-security-policy');
        head.delete('content-security-policy-report-only');
        head.delete('clear-site-data');
        head.delete('Cache-Control');
        head.delete('Content-Encoding');
        const headObj = {};
        for (let [k, v] of head) {
            headObj[k] = v;
        }
        // send response headers to client
        res.header(headObj);
        // send response status to client
        res.status(originalResponse.status);
        // send response body to client
        await pipeline(originalResponse.body, res);
    }
    catch (err) {
        if (err?.name === 'AbortError') {
            if (!res.headersSent) {
                res.status(504).send({
                    error: timeoutMs
                        ? `Proxy request timed out after ${timeoutMs}ms`
                        : 'Proxy request aborted'
                });
            } else {
                res.end();
            }
            return;
        }
        next(err);
        return;
    } finally {
        timeout.cleanup();
    }
}

let accessTokenCache = {
    token: null,
    expiry: 0
}
async function getSionywAccessToken() {
    if(accessTokenCache.token && Date.now() < accessTokenCache.expiry){
        return accessTokenCache.token;
    }
    //Schema of the client data file
    // {
    //     refresh_token: string;
    //     client_id: string;
    //     client_secret: string;
    // }
    
    const clientDataPath = path.join(process.cwd(), 'save', '__sionyw_client_data.json');
    let refreshToken = ''
    let clientId = ''
    let clientSecret = ''
    if(!existsSync(clientDataPath)){
        throw new Error('No Sionyw client data found');
    }
    const clientDataRaw = readFileSync(clientDataPath, 'utf-8');
    const clientData = JSON.parse(clientDataRaw);
    refreshToken = clientData.refresh_token;
    clientId = clientData.client_id;
    clientSecret = clientData.client_secret;

    //Oauth Refresh Token Flow
    
    const tokenResponse = await fetch('account.sionyw.com/account/api/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret
        })
    })

    if(!tokenResponse.ok){
        throw new Error('Failed to refresh Sionyw access token');
    }

    const tokenData = await tokenResponse.json();

    //Update the refresh token in the client data file
    if(tokenData.refresh_token && tokenData.refresh_token !== refreshToken){
        clientData.refresh_token = tokenData.refresh_token;
        writeFileSync(clientDataPath, JSON.stringify(clientData), 'utf-8');
    }

    accessTokenCache.token = tokenData.access_token;
    accessTokenCache.expiry = Date.now() + (tokenData.expires_in * 1000) - (5 * 60 * 1000); //5 minutes early

    return tokenData.access_token;
}


async function hubProxyFunc(req, res) {
    const excludedHeaders = new Set([
        'content-encoding',
        'content-length',
        'transfer-encoding'
    ]);

    try {
        let externalURL = '';

        const pathHeader = req.headers['x-risu-node-path'];
        if (pathHeader) {
            const decodedPath = decodeURIComponent(pathHeader);
            externalURL = decodedPath;
        } else {
            const pathAndQuery = req.originalUrl.replace(/^\/hub-proxy/, '');
            externalURL = hubURL + pathAndQuery;
        }
        
        const headersToSend = { ...req.headers };
        delete headersToSend.host;
        delete headersToSend.connection;
        delete headersToSend['content-length'];
        delete headersToSend['x-risu-node-path'];

        const hubOrigin = new URL(hubURL).origin;
        headersToSend.origin = hubOrigin;

        //if Authorization header is "Server-Auth, set the token to be Server-Auth
        if(headersToSend['Authorization'] === 'X-Node-Server-Auth'){
            //this requires password auth
            if(!await checkAuth(req, res)){
                return;
            }

            headersToSend['Authorization'] = "Bearer " + await getSionywAccessToken();
            delete headersToSend['risu-auth'];
        }
        
        
        const response = await fetch(externalURL, {
            method: req.method,
            headers: headersToSend,
            body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
            redirect: 'manual',
            duplex: 'half'
        });
        
        for (const [key, value] of response.headers.entries()) {
            // Skip encoding-related headers to prevent double decoding
            if (excludedHeaders.has(key.toLowerCase())) {
                continue;
            }
            res.setHeader(key, value);
        }
        res.status(response.status);

        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
            const redirectUrl = response.headers.get('location');
            const newHeaders = { ...headersToSend };
            const redirectResponse = await fetch(redirectUrl, {
                method: req.method,
                headers: newHeaders,
                body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
                redirect: 'manual',
                duplex: 'half'
            });
            for (const [key, value] of redirectResponse.headers.entries()) {
                if (excludedHeaders.has(key.toLowerCase())) {
                    continue;
                }
                res.setHeader(key, value);
            }
            res.status(redirectResponse.status);
            if (redirectResponse.body) {
                await pipeline(redirectResponse.body, res);
            } else {
                res.end();
            }
            return;
        }
        const contentType = response.headers.get('content-type') || '';
        const isEventStream = contentType.includes('text/event-stream');

        let keepAliveInterval = null;
        if (isEventStream) {
            // Force headers early
            res.flushHeaders();
            keepAliveInterval = setInterval(() => {
                if (!res.writableEnded) {
                    res.write('\n');
                }
            }, 15000);
        }

        const cleanupInterval = () => {
            if (keepAliveInterval) {
                clearInterval(keepAliveInterval);
            }
        };

        res.on('close', cleanupInterval);

        try {
            if (response.body) {
                await pipeline(response.body, res);
            } else {
                res.end();
            }
        } finally {
            cleanupInterval();
        }
        
    } catch (error) {
        console.error("[Hub Proxy] Error:", error);
        if (!res.headersSent) {
            res.status(502).send({ error: 'Proxy request failed: ' + error.message });
        } else {
            res.end();
        }
    }
}

app.get('/proxy', reverseProxyFunc_get);
app.get('/proxy2', reverseProxyFunc_get);
app.get('/hub-proxy/*', hubProxyFunc);

app.post('/proxy', reverseProxyFunc);
app.post('/proxy2', reverseProxyFunc);
app.post('/hub-proxy/*', hubProxyFunc);
app.post('/proxy-stream-jobs', async (req, res) => {
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
    if (bodyBase64.length > PROXY_STREAM_MAX_BODY_BASE64_BYTES) {
        res.status(413).send({ error: 'Request body too large' });
        return;
    }
    if (proxyStreamJobs.size >= PROXY_STREAM_MAX_ACTIVE_JOBS) {
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

app.delete('/proxy-stream-jobs/:jobId', async (req, res) => {
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

// app.get('/api/password', async(req, res)=> {
//     if(password === ''){
//         res.send({status: 'unset'})
//     }
//     else if(req.body.password && req.body.password.trim() === password.trim()){
//         res.send({status:'correct'})
//     }
//     else{
//         res.send({status:'incorrect'})
//     }
// })

app.get('/api/test_auth', authRouteLimiter, async(req, res) => {

    if(!password){
        res.send({status: 'unset'})
    }
    else if(!await checkAuth(req, res, true)){
        res.send({status: 'incorrect'})
    }
    else{
        res.send({status: 'success'})
    }
})

app.post('/api/login', loginRouteLimiter, async (req, res) => {
    if(password === ''){
        res.status(400).send({error: 'Password not set'})
        return;
    }
    if(req.body.password && req.body.password.trim() === password.trim()){
        const publicKeyHash = await hashJSON(req.body.publicKey)
        knownPublicKeysHashes.add(publicKeyHash)
        writeFileSync(knownPublicKeysPath, JSON.stringify(Array.from(knownPublicKeysHashes)), 'utf-8')
        res.send({status:'success'})
    }
    else{
        res.status(400).send({error: 'Password incorrect'})
    }
})

app.post('/api/crypto', async (req, res) => {
    try {
        const hash = crypto.createHash('sha256')
        hash.update(Buffer.from(req.body.data, 'utf-8'))
        res.send(hash.digest('hex'))
    } catch (error) {
        res.status(500).send({ error: 'Crypto operation failed' });
    }
})


app.post('/api/set_password', async (req, res) => {
    if(password === ''){
        password = req.body.password
        writeFileSync(passwordPath, password, 'utf-8')
        res.send({status: 'success'})
    }
    else{
        res.status(400).send("already set")
    }
})

app.get('/api/read', authenticatedRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    const filePath = req.headers['file-path'];
    if (!filePath) {
        console.log('no path')
        res.status(400).send({
            error:'File path required'
        });
        return;
    }

    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }
    try {
        if(!existsSync(path.join(savePath, filePath))){
            res.send();
        }
        else{
            res.setHeader('Content-Type','application/octet-stream');
            res.sendFile(path.join(savePath, filePath));
        }
    } catch (error) {
        next(error);
    }
});

app.get('/api/remove', authenticatedRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    const filePath = req.headers['file-path'];
    if (!filePath) {
        res.status(400).send({
            error:'File path required'
        });
        return;
    }
    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }

    try {
        await fs.rm(path.join(savePath, filePath));
        res.send({
            success: true,
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/list', authenticatedRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    try {
        const data = (await fs.readdir(path.join(savePath))).map((v) => {
            return Buffer.from(v, 'hex').toString('utf-8')
        })
        res.send({
            success: true,
            content: data
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/write', authenticatedRouteLimiter, async (req, res, next) => {
    if(!await checkAuth(req, res)){
        return;
    }
    const filePath = req.headers['file-path'];
    const fileContent = req.body
    if (!filePath || !fileContent) {
        res.status(400).send({
            error:'File path required'
        });
        return;
    }
    if(!isHex(filePath)){
        res.status(400).send({
            error:'Invaild Path'
        });
        return;
    }

    try {
        await fs.writeFile(path.join(savePath, filePath), fileContent);
        res.send({
            success: true
        });
    } catch (error) {
        next(error);
    }
});

// ─── Block-based diff save system ───

let saveLock = Promise.resolve();
function withSaveLock(fn) {
    saveLock = saveLock.then(fn, fn);
    return saveLock;
}

function isSafeBlockName(name) {
    return safeBlockNameRegex.test(name) && name.length <= 128;
}

async function hashData(data) {
    const hash = crypto.createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
}

async function readManifest() {
    const manifestPath = path.join(dbBlocksPath, '__manifest.json');
    const bakPath = path.join(dbBlocksPath, '__manifest.bak.json');
    const newPath = path.join(dbBlocksPath, '__manifest.new.json');

    // Recovery: if __manifest.new.json exists but __manifest.json does not, rename it
    if (!existsSync(manifestPath) && existsSync(newPath)) {
        await fs.rename(newPath, manifestPath);
    }

    if (existsSync(manifestPath)) {
        try {
            return JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        } catch (e) {
            // Corrupt manifest, try backup
            if (existsSync(bakPath)) {
                try {
                    const bak = JSON.parse(await fs.readFile(bakPath, 'utf-8'));
                    await fs.writeFile(manifestPath, JSON.stringify(bak), 'utf-8');
                    return bak;
                } catch (e2) { /* fall through */ }
            }
        }
    }
    return { version: 0, blocks: {} };
}

async function writeManifestAtomic(manifest) {
    const manifestPath = path.join(dbBlocksPath, '__manifest.json');
    const bakPath = path.join(dbBlocksPath, '__manifest.bak.json');
    const newPath = path.join(dbBlocksPath, '__manifest.new.json');

    await fs.writeFile(newPath, JSON.stringify(manifest), 'utf-8');
    if (existsSync(manifestPath)) {
        await fs.rename(manifestPath, bakPath);
    }
    await fs.rename(newPath, manifestPath);
}

// Parse RISUSAVE blocks from a monolithic binary file
function parseRisuSaveBlocks(data) {
    const headerStr = "RISUSAVE\0";
    const headerBytes = Buffer.from(headerStr, 'utf-8');

    // Check if it starts with RISUSAVE header
    if (data.length < headerBytes.length) return null;
    for (let i = 0; i < headerBytes.length; i++) {
        if (data[i] !== headerBytes[i]) return null;
    }

    const blocks = {};
    let offset = headerBytes.length;

    while (offset < data.length) {
        try {
            const type = data[offset];
            const compression = data[offset + 1];
            offset += 2;

            const nameLength = data[offset];
            offset += 1;
            const name = data.subarray(offset, offset + nameLength).toString('utf-8');
            offset += nameLength;

            const dataLength = data.readUInt32LE(offset);
            offset += 4;

            // The complete block is: type(1) + compression(1) + nameLen(1) + name(var) + dataLen(4) + data(var)
            // offset is now past dataLen, so blockStart goes back by: 4(dataLen) + nameLength + 1(nameLen) + 2(type+comp)
            const blockStart = offset - 4 - nameLength - 1 - 2;
            const blockEnd = offset + dataLength;
            blocks[name] = Buffer.from(data.subarray(blockStart, blockEnd));

            offset += dataLength;
        } catch (e) {
            break;
        }
    }
    return blocks;
}

async function migrateMonolithicToBlocks() {
    if (existsSync(dbBlocksPath)) return;

    // Find monolithic database.bin file
    const dbKey = 'database/database.bin';
    const hexPath = Buffer.from(dbKey, 'utf-8').toString('hex');
    const monolithicPath = path.join(savePath, hexPath);

    if (!existsSync(monolithicPath)) {
        // No existing data, just create the directory
        await fs.mkdir(dbBlocksPath, { recursive: true });
        await writeManifestAtomic({ version: 1, blocks: {} });
        return;
    }

    console.log('[Server] Migrating monolithic database to block storage...');
    const data = await fs.readFile(monolithicPath);
    const blocks = parseRisuSaveBlocks(data);

    if (!blocks || Object.keys(blocks).length === 0) {
        console.log('[Server] Could not parse monolithic file as RISUSAVE, creating empty block storage');
        await fs.mkdir(dbBlocksPath, { recursive: true });
        await writeManifestAtomic({ version: 1, blocks: {} });
        return;
    }

    await fs.mkdir(dbBlocksPath, { recursive: true });
    const manifest = { version: 1, blocks: {} };

    for (const [name, blockData] of Object.entries(blocks)) {
        if (!isSafeBlockName(name)) {
            console.warn(`[Server] Skipping block with unsafe name: ${name}`);
            continue;
        }
        const blockPath = path.join(dbBlocksPath, `${name}.bin`);
        await fs.writeFile(blockPath, blockData);
        manifest.blocks[name] = {
            hash: await hashData(blockData),
            size: blockData.length
        };
    }

    await writeManifestAtomic(manifest);
    console.log(`[Server] Migration complete: ${Object.keys(manifest.blocks).length} blocks`);
}

// ─── JSON Patch helpers ───

// Extract raw JSON string from a RISUSAVE binary block
function extractJsonFromBlock(blockData) {
    // Block format: type(1) + compression(1) + nameLen(1) + name(nameLen) + dataLen(4LE) + data(dataLen)
    const compression = blockData[1];
    const nameLen = blockData[2];
    const dataOffset = 3 + nameLen + 4;
    let data = blockData.subarray(dataOffset);
    if (compression === 1) {
        data = zlib.gunzipSync(data);
    }
    return data.toString('utf-8');
}

// Extract block type from a RISUSAVE binary block
function extractBlockType(blockData) {
    return blockData[0];
}

// Re-encode a JSON string into a RISUSAVE binary block (uncompressed)
function encodeJsonToBlock(type, name, jsonString) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const dataBuf = Buffer.from(jsonString, 'utf-8');
    const block = Buffer.alloc(2 + 1 + nameBuf.length + 4 + dataBuf.length);
    block[0] = type;
    block[1] = 0; // no compression
    block[2] = nameBuf.length;
    nameBuf.copy(block, 3);
    block.writeUInt32LE(dataBuf.length, 3 + nameBuf.length);
    dataBuf.copy(block, 7 + nameBuf.length);
    return block;
}

// Navigate to a nested value by JSON Pointer path segments
function getByPath(obj, segments) {
    let cur = obj;
    for (const seg of segments) {
        if (cur == null) return undefined;
        const key = seg.replace(/~1/g, '/').replace(/~0/g, '~');
        if (Array.isArray(cur)) {
            cur = cur[parseInt(key, 10)];
        } else {
            cur = cur[key];
        }
    }
    return cur;
}

// Set a nested value by JSON Pointer path segments
function setByPath(obj, segments, value) {
    let cur = obj;
    for (let i = 0; i < segments.length - 1; i++) {
        const key = segments[i].replace(/~1/g, '/').replace(/~0/g, '~');
        if (Array.isArray(cur)) {
            cur = cur[parseInt(key, 10)];
        } else {
            cur = cur[key];
        }
    }
    const lastKey = segments[segments.length - 1].replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) {
        cur[parseInt(lastKey, 10)] = value;
    } else {
        cur[lastKey] = value;
    }
}

// Delete a nested value by JSON Pointer path segments
function deleteByPath(obj, segments) {
    let cur = obj;
    for (let i = 0; i < segments.length - 1; i++) {
        const key = segments[i].replace(/~1/g, '/').replace(/~0/g, '~');
        if (Array.isArray(cur)) {
            cur = cur[parseInt(key, 10)];
        } else {
            cur = cur[key];
        }
    }
    const lastKey = segments[segments.length - 1].replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) {
        cur.splice(parseInt(lastKey, 10), 1);
    } else {
        delete cur[lastKey];
    }
}

// Apply an array of JSON patch operations to an object (returns new object)
function applyJsonPatch(obj, ops) {
    obj = structuredClone(obj); // deep clone
    for (const op of ops) {
        const segments = op.path.split('/').filter(Boolean);
        if (op.op === 'replace' || op.op === 'add') {
            setByPath(obj, segments, op.value);
        } else if (op.op === 'remove') {
            deleteByPath(obj, segments);
        } else if (op.op === 'append') {
            const arr = getByPath(obj, segments);
            if (Array.isArray(arr)) {
                arr.push(...op.items);
            }
        }
    }
    return obj;
}

// Load JSON for a block: prefer .json file, fall back to extracting from .bin
async function loadBlockJson(name) {
    const jsonPath = path.join(dbBlocksPath, `${name}.json`);
    if (existsSync(jsonPath)) {
        return await fs.readFile(jsonPath, 'utf-8');
    }
    // Fall back: extract from .bin
    const binPath = path.join(dbBlocksPath, `${name}.bin`);
    if (existsSync(binPath)) {
        const binData = await fs.readFile(binPath);
        const jsonStr = extractJsonFromBlock(binData);
        // Cache the extracted JSON for future use
        await fs.writeFile(jsonPath, jsonStr, 'utf-8');
        return jsonStr;
    }
    return null;
}

app.get('/api/save-capabilities', (req, res) => {
    res.json({ diffSave: true, jsonPatch: true, version: 2 });
});

app.get('/api/save-manifest', async (req, res) => {
    if (!await checkAuth(req, res)) return;
    try {
        if (!existsSync(dbBlocksPath)) {
            res.json({ version: 0, blocks: {}, exists: false });
            return;
        }
        const manifest = await readManifest();
        res.json({ ...manifest, exists: true });
    } catch (error) {
        console.error('[Server] save-manifest error:', error);
        res.status(500).json({ error: 'Failed to read manifest' });
    }
});

app.post('/api/save-diff', async (req, res) => {
    if (!await checkAuth(req, res)) return;

    try {
        await withSaveLock(async () => {
            const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);

            if (body.length < 4) {
                res.status(400).json({ error: 'Invalid payload' });
                return;
            }

            // Parse header
            const headerLen = body.readUInt32LE(0);
            if (4 + headerLen > body.length) {
                res.status(400).json({ error: 'Invalid header length' });
                return;
            }
            const headerJson = body.subarray(4, 4 + headerLen).toString('utf-8');
            let header;
            try {
                header = JSON.parse(headerJson);
            } catch (e) {
                res.status(400).json({ error: 'Invalid header JSON' });
                return;
            }

            const { changedBlocks = {}, deletedBlocks = [] } = header;

            // Auto-migrate if needed
            await migrateMonolithicToBlocks();

            // Parse block data from the payload
            let offset = 4 + headerLen;
            const receivedBlocks = {};
            const changedNames = Object.keys(changedBlocks);

            for (const name of changedNames) {
                if (offset + 2 > body.length) break;
                const nameLen = body.readUInt16LE(offset); offset += 2;

                if (offset + nameLen > body.length) break;
                const blockName = body.subarray(offset, offset + nameLen).toString('utf-8'); offset += nameLen;

                if (offset + 4 > body.length) break;
                const dataLen = body.readUInt32LE(offset); offset += 4;

                if (offset + dataLen > body.length) break;
                const blockData = body.subarray(offset, offset + dataLen); offset += dataLen;

                if (!isSafeBlockName(blockName)) {
                    console.warn(`[Server] Rejecting unsafe block name: ${blockName}`);
                    continue;
                }

                // Verify hash
                const computedHash = await hashData(blockData);
                if (changedBlocks[blockName] && changedBlocks[blockName].hash !== computedHash) {
                    console.warn(`[Server] Hash mismatch for block: ${blockName}`);
                    res.status(400).json({ error: `Hash mismatch for block: ${blockName}` });
                    return;
                }

                receivedBlocks[blockName] = { data: blockData, hash: computedHash };
            }

            // Write changed blocks atomically (.bin + .json)
            for (const [name, { data }] of Object.entries(receivedBlocks)) {
                const tmpPath = path.join(dbBlocksPath, `${name}.bin.tmp`);
                const finalPath = path.join(dbBlocksPath, `${name}.bin`);
                await fs.writeFile(tmpPath, data);
                await fs.rename(tmpPath, finalPath);
                // Also extract and cache JSON for json-patch support
                try {
                    const jsonStr = extractJsonFromBlock(data);
                    await fs.writeFile(path.join(dbBlocksPath, `${name}.json`), jsonStr, 'utf-8');
                } catch (e) {
                    // Non-critical: .json cache can be rebuilt on demand
                    console.warn(`[Server] Could not extract JSON for block ${name}:`, e.message);
                }
            }

            // Delete removed blocks (.bin + .json)
            for (const name of deletedBlocks) {
                if (!isSafeBlockName(name)) continue;
                try { await fs.rm(path.join(dbBlocksPath, `${name}.bin`)); } catch (e) { /* file may not exist */ }
                try { await fs.rm(path.join(dbBlocksPath, `${name}.json`)); } catch (e) { /* file may not exist */ }
            }

            // Update manifest
            const manifest = await readManifest();
            for (const [name, { hash, data }] of Object.entries(receivedBlocks)) {
                manifest.blocks[name] = { hash, size: data.length };
            }
            for (const name of deletedBlocks) {
                delete manifest.blocks[name];
            }
            manifest.version = (manifest.version || 0) + 1;
            await writeManifestAtomic(manifest);

            res.json(manifest);
        });
    } catch (error) {
        console.error('[Server] save-diff error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// Support both GET (backward compat) and POST (for large block lists)
const handleSaveBlocks = async (req, res) => {
    if (!await checkAuth(req, res)) return;

    try {
        // Get names from POST body or GET query string
        let names;
        if (req.method === 'POST' && req.body && req.body.names) {
            names = req.body.names.filter(n => isSafeBlockName(n));
        } else {
            const namesParam = req.query.names;
            if (!namesParam) {
                res.status(400).json({ error: 'names parameter required' });
                return;
            }
            names = namesParam.split(',').filter(n => isSafeBlockName(n));
        }

        const buffers = [];
        let totalSize = 0;

        for (const name of names) {
            const blockPath = path.join(dbBlocksPath, `${name}.bin`);
            if (!existsSync(blockPath)) continue;

            const data = await fs.readFile(blockPath);
            const nameBuf = Buffer.from(name, 'utf-8');

            // [nameLen:2B][name][dataLen:4B][data]
            const entryBuf = Buffer.alloc(2 + nameBuf.length + 4 + data.length);
            entryBuf.writeUInt16LE(nameBuf.length, 0);
            nameBuf.copy(entryBuf, 2);
            entryBuf.writeUInt32LE(data.length, 2 + nameBuf.length);
            data.copy(entryBuf, 2 + nameBuf.length + 4);

            buffers.push(entryBuf);
            totalSize += entryBuf.length;
        }

        const result = Buffer.concat(buffers, totalSize);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.send(result);
    } catch (error) {
        console.error('[Server] save-blocks error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
app.get('/api/save-blocks', handleSaveBlocks);
app.post('/api/save-blocks', handleSaveBlocks);

app.post('/api/save-json-patch', async (req, res) => {
    if (!await checkAuth(req, res)) return;

    try {
        await withSaveLock(async () => {
            // Accept JSON body (express.json middleware handles parsing)
            const { patches = {}, expectedHashes = {}, deletedBlocks = [], manifestVersion = 0 } = req.body;

            if (typeof patches !== 'object' || typeof expectedHashes !== 'object') {
                res.status(400).json({ error: 'Invalid payload' });
                return;
            }

            await migrateMonolithicToBlocks();

            const rejected = [];
            const applied = {}; // name → { jsonStr, blockBuf, hash }

            for (const [name, ops] of Object.entries(patches)) {
                if (!isSafeBlockName(name) || !Array.isArray(ops)) {
                    rejected.push(name);
                    continue;
                }

                try {
                    // Load current JSON for this block
                    const currentJsonStr = await loadBlockJson(name);
                    if (currentJsonStr === null) {
                        console.warn(`[Server] json-patch: block ${name} not found, rejecting`);
                        rejected.push(name);
                        continue;
                    }

                    // Apply patch
                    const currentObj = JSON.parse(currentJsonStr);
                    const patchedObj = applyJsonPatch(currentObj, ops);
                    const patchedJsonStr = JSON.stringify(patchedObj);

                    // Verify hash
                    const patchedHash = await hashData(Buffer.from(patchedJsonStr, 'utf-8'));
                    if (expectedHashes[name] && patchedHash !== expectedHashes[name]) {
                        console.warn(`[Server] json-patch: hash mismatch for ${name} (expected ${expectedHashes[name]}, got ${patchedHash})`);
                        rejected.push(name);
                        continue;
                    }

                    // Read block type from existing .bin
                    const binPath = path.join(dbBlocksPath, `${name}.bin`);
                    let blockType = 1; // default to ROOT
                    if (existsSync(binPath)) {
                        const existingBin = await fs.readFile(binPath);
                        blockType = extractBlockType(existingBin);
                    }

                    // Re-encode to binary block
                    const blockBuf = encodeJsonToBlock(blockType, name, patchedJsonStr);
                    const blockHash = await hashData(blockBuf);

                    applied[name] = { jsonStr: patchedJsonStr, blockBuf, hash: blockHash };
                } catch (e) {
                    console.warn(`[Server] json-patch: error applying patch to ${name}:`, e.message);
                    rejected.push(name);
                }
            }

            // Write applied blocks atomically
            for (const [name, { jsonStr, blockBuf }] of Object.entries(applied)) {
                // Write .bin
                const tmpBin = path.join(dbBlocksPath, `${name}.bin.tmp`);
                const finalBin = path.join(dbBlocksPath, `${name}.bin`);
                await fs.writeFile(tmpBin, blockBuf);
                await fs.rename(tmpBin, finalBin);
                // Write .json
                await fs.writeFile(path.join(dbBlocksPath, `${name}.json`), jsonStr, 'utf-8');
            }

            // Delete removed blocks
            for (const name of deletedBlocks) {
                if (!isSafeBlockName(name)) continue;
                try { await fs.rm(path.join(dbBlocksPath, `${name}.bin`)); } catch (e) {}
                try { await fs.rm(path.join(dbBlocksPath, `${name}.json`)); } catch (e) {}
            }

            // Update manifest
            const manifest = await readManifest();
            for (const [name, { hash, blockBuf }] of Object.entries(applied)) {
                manifest.blocks[name] = { hash, size: blockBuf.length };
            }
            for (const name of deletedBlocks) {
                delete manifest.blocks[name];
            }
            manifest.version = (manifest.version || 0) + 1;
            await writeManifestAtomic(manifest);

            const patchedNames = Object.keys(applied);
            const totalPatchOps = Object.values(patches).reduce((sum, ops) => sum + ops.length, 0);
            console.log(`[Server] json-patch: applied ${patchedNames.length} blocks (${totalPatchOps} ops), rejected ${rejected.length}`);

            res.json({ ...manifest, exists: true, rejected });
        });
    } catch (error) {
        console.error('[Server] save-json-patch error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// ─── End block-based diff save system ───

const oauthData = {
    client_id: '',
    client_secret: '',
    config: {},
    code_verifier: ''

}
app.get('/api/oauth_login', async (req, res) => {
    const redirect_uri = (new URL (req.url)).host + '/api/oauth_callback'

    if(!redirect_uri){
        res.status(400).send({ error: 'redirect_uri is required' });
        return
    }
    if(!oauthData.client_id || !oauthData.client_secret){
        const discovery = await openid.discovery('https://account.sionyw.com/','','');
        oauthData.config = discovery;

        //oauth dynamic client registration
        //https://datatracker.ietf.org/doc/html/rfc7591

        const serverMeta = discovery.serverMetadata()
        //since we can't find a good library to do this, we will do it manually
        const registrationResponse = await fetch(serverMeta.registration_endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (serverMeta.registration_access_token || '')
            },
            body: JSON.stringify({
                client_id: oauthData.client_id,
                client_secret: oauthData.client_secret,
                redirect_uris: [redirect_uri],
                response_types: ['code'],
                grant_types: ['authorization_code'],
                scope: 'risuai',
                token_endpoint_auth_method: 'client_secret_basic',
                client_name: 'Risuai Node Server',
            })
        });

        if(registrationResponse.status === 201 || registrationResponse.status === 200){
            const registrationData = await registrationResponse.json();
            oauthData.client_id = registrationData.client_id;
            oauthData.client_secret = registrationData.client_secret;
            discovery.clientMetadata().client_id = oauthData.client_id;
            discovery.clientMetadata().client_secret = oauthData.client_secret;
        }
        else{
            console.error('[Server] OAuth2 dynamic client registration failed:', registrationResponse.statusText);
            res.status(500).send({ error: 'OAuth2 client registration failed' });
            return
        }


        //now lets request

        let code_verifier = openid.randomPKCECodeVerifier();
        let code_challenge = await openid.calculatePKCECodeChallenge(code_verifier);

        oauthData.code_verifier = code_verifier;
        let redirectTo = openid.buildAuthorizationUrl(oauthData.config, {
            redirect_uri,
            code_challenge,
            code_challenge_method: 'S256',
            scope: 'risuai',
        })

        res.redirect(redirectTo.toString());

        return;

    }
    
    res.status(500).send({ error: 'OAuth2 login failed' });
});

app.get('/api/oauth_callback', async (req, res) => {

    //since this is a callback we don't need to check password

    const params = (new URL(req.url, `http://${req.headers.host}`)).searchParams;
    const code = params.get('code');

    if(!code){
        res.status(400).send({ error: 'code is required' });
        return
    }
    if(!oauthData.client_id || !oauthData.client_secret || !oauthData.code_verifier){
        res.status(400).send({ error: 'OAuth2 not initialized' });
        return
    }

    let tokens = await openid.authorizationCodeGrant(
        oauthData.config,   
        getCurrentUrl(),
        {
            pkceCodeVerifier: oauthData.code_verifier,
        },
    )

    writeFileSync(authCodePath, tokens.access_token, 'utf-8')

    res.send(tokens)
            
})

async function getHttpsOptions() {

    const keyPath = path.join(sslPath, 'server.key');
    const certPath = path.join(sslPath, 'server.crt');

    try {
 
        await fs.access(keyPath);
        await fs.access(certPath);

        const [key, cert] = await Promise.all([
            fs.readFile(keyPath),
            fs.readFile(certPath)
        ]);
       
        return { key, cert };

    } catch (error) {
        console.error('[Server] SSL setup errors:', error.message);
        console.log('[Server] Start the server with HTTP instead of HTTPS...');
        return null;
    }
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

async function startServer() {
    try {
      
        const port = process.env.PORT || 6001;
        const httpsOptions = await getHttpsOptions();
        let server = null;

        if (httpsOptions) {
            // HTTPS
            server = https.createServer(httpsOptions, app);
            setupProxyStreamWebSocket(server);
            server.listen(port, () => {
                console.log("[Server] HTTPS server is running.");
                console.log(`[Server] https://localhost:${port}/`);
            });
        } else {
            // HTTP
            server = http.createServer(app);
            setupProxyStreamWebSocket(server);
            server.listen(port, () => {
                console.log("[Server] HTTP server is running.");
                console.log(`[Server] http://localhost:${port}/`);
            });
        }
    } catch (error) {
        console.error('[Server] Failed to start server :', error);
        process.exit(1);
    }
}

(async () => {
    setInterval(() => {
        const now = Date.now();
        for (const [jobId, job] of proxyStreamJobs.entries()) {
            if (!job.done && now >= job.deadlineAt && !job.abortController.signal.aborted) {
                job.abortController.abort();
            }
            if (job.done && job.clients.size === 0 && job.cleanupAt > 0 && now >= job.cleanupAt) {
                cleanupJob(jobId);
                continue;
            }
            if (!job.done && now - job.updatedAt > Math.max(PROXY_STREAM_DEFAULT_TIMEOUT_MS, job.timeoutMs * 2)) {
                cleanupJob(jobId);
            }
        }
    }, PROXY_STREAM_GC_INTERVAL_MS);
    await startServer();
})();
