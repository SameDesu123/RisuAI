const express = require('express');
const app = express();
const path = require('path');
const htmlparser = require('node-html-parser');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const fs = require('fs/promises')
const nodeCrypto = require('crypto')
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
let knownPublicKeysHashes = []

const savePath = path.join(process.cwd(), "save")
if(!existsSync(savePath)){
    mkdirSync(savePath)
}

const passwordPath = path.join(process.cwd(), 'save', '__password')
if(existsSync(passwordPath)){
    password = readFileSync(passwordPath, 'utf-8')
}

const authCodePath = path.join(process.cwd(), 'save', '__authcode')
const dbBlocksPath = path.join(savePath, '__dbblocks')
const hexRegex = /^[0-9a-fA-F]+$/;
// Safe block name: alphanumeric, hyphens, underscores only
const safeBlockNameRegex = /^[a-zA-Z0-9_-]+$/;

function isHex(str) {
    return hexRegex.test(str.toUpperCase().trim()) || str === '__password';
}

async function hashJSON(json){
    const hash = nodeCrypto.createHash('sha256');
    hash.update(JSON.stringify(json));
    return hash.digest('hex');
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
        const authHeader = req.headers['risu-auth'];

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
        if(!knownPublicKeysHashes.includes(pubKeyHash)){
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
    if(!await checkAuth(req, res)){
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

    let originalResponse;
    try {
        // make request to original server
        originalResponse = await fetch(urlParam, {
            method: req.method,
            headers: header,
            body: JSON.stringify(req.body)
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
        try {
            res.write(JSON.stringify({ error: err.message || 'Proxy request failed' }));
            res.end();
        } catch (writeErr) {
            // Client already disconnected, nothing to do
        }
    }
}

const reverseProxyFunc_get = async (req, res, next) => {
    if(!await checkAuth(req, res)){
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
    let originalResponse;
    try {
        // make request to original server
        originalResponse = await fetch(urlParam, {
            method: 'GET',
            headers: header
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
        next(err);
        return;
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
    const excludedHeaders = [
        'content-encoding',
        'content-length',
        'transfer-encoding'
    ];

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
            if (excludedHeaders.includes(key.toLowerCase())) {
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
                if (excludedHeaders.includes(key.toLowerCase())) {
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

app.get('/api/test_auth', async(req, res) => {

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

let loginTries = 0;
let loginTriesResetsIn = 0;
app.post('/api/login', async (req, res) => {

    if(loginTriesResetsIn < Date.now()){
        loginTriesResetsIn = Date.now() + (30 * 1000); //30 seconds
        loginTries = 0;
    }

    if(loginTries >= 10){
        res.status(429).send({error: 'Too many attempts. Please wait and try again later.'})
        return;
    }
    else{
        loginTries++;
    }

    if(password === ''){
        res.status(400).send({error: 'Password not set'})
        return;
    }
    if(req.body.password && req.body.password.trim() === password.trim()){
        knownPublicKeysHashes.push(await hashJSON(req.body.publicKey))
        res.send({status:'success'})
    }
    else{
        res.status(400).send({error: 'Password incorrect'})
    }
})

app.post('/api/crypto', async (req, res) => {
    try {
        const hash = nodeCrypto.createHash('sha256')
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

app.get('/api/read', async (req, res, next) => {
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

app.get('/api/remove', async (req, res, next) => {
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

app.get('/api/list', async (req, res, next) => {
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

app.post('/api/write', async (req, res, next) => {
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
    const hash = nodeCrypto.createHash('sha256');
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
    obj = JSON.parse(JSON.stringify(obj)); // deep clone
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

app.get('/api/save-blocks', async (req, res) => {
    if (!await checkAuth(req, res)) return;

    try {
        const namesParam = req.query.names;
        if (!namesParam) {
            res.status(400).json({ error: 'names parameter required' });
            return;
        }

        const names = namesParam.split(',').filter(n => isSafeBlockName(n));
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
});

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

    fs.writeFileSync(authCodePath, tokens.access_token, 'utf-8')

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

async function startServer() {
    try {
      
        const port = process.env.PORT || 6001;
        const httpsOptions = await getHttpsOptions();

        if (httpsOptions) {
            // HTTPS
            https.createServer(httpsOptions, app).listen(port, () => {
                console.log("[Server] HTTPS server is running.");
                console.log(`[Server] https://localhost:${port}/`);
            });
        } else {
            // HTTP
            app.listen(port, () => {
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
    await startServer();
})();
