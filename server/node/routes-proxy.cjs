const path = require('path');
const { existsSync, readFileSync, writeFileSync } = require('fs');
const fs = require('fs/promises');
const { pipeline } = require('stream/promises');
const { authCodePath, hubURL } = require('./config.cjs');

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

function registerProxyRoutes(app, arg) {
    const {
        state,
        authenticatedRouteLimiter,
        authHelpers,
    } = arg;
    const { checkAuth, checkProxyAuth } = authHelpers;
    const routeGet = (...args) => app.get(...args);
    const routePost = (...args) => app.post(...args);

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
        const timeoutMs = getRequestTimeoutMs(req.headers['risu-timeout-ms']);
        const timeout = createTimeoutController(timeoutMs);
        let originalResponse;
        try {
            originalResponse = await fetch(urlParam, {
                method: req.method,
                headers: header,
                body: JSON.stringify(req.body),
                signal: timeout.signal
            });
            const originalBody = originalResponse.body;
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
            res.header(headObj);
            res.status(originalResponse.status);
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
            originalResponse = await fetch(urlParam, {
                method: 'GET',
                headers: header,
                signal: timeout.signal
            });
            const originalBody = originalResponse.body;
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
            res.header(headObj);
            res.status(originalResponse.status);
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

    async function getSionywAccessToken() {
        if(state.accessTokenCache.token && Date.now() < state.accessTokenCache.expiry){
            return state.accessTokenCache.token;
        }

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

        if(tokenData.refresh_token && tokenData.refresh_token !== refreshToken){
            clientData.refresh_token = tokenData.refresh_token;
            writeFileSync(clientDataPath, JSON.stringify(clientData), 'utf-8');
        }

        state.accessTokenCache.token = tokenData.access_token;
        state.accessTokenCache.expiry = Date.now() + (tokenData.expires_in * 1000) - (5 * 60 * 1000); //5 minutes early

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

            if(headersToSend['Authorization'] === 'X-Node-Server-Auth'){
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

            if (response.body) {
                await pipeline(response.body, res);
            } else {
                res.end();
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
    routeGet('/proxy', authenticatedRouteLimiter, reverseProxyFunc_get);
    routeGet('/proxy2', authenticatedRouteLimiter, reverseProxyFunc_get);
    routeGet('/hub-proxy/*', authenticatedRouteLimiter, hubProxyFunc);
    routePost('/proxy', authenticatedRouteLimiter, reverseProxyFunc);
    routePost('/proxy2', authenticatedRouteLimiter, reverseProxyFunc);
    routePost('/hub-proxy/*', authenticatedRouteLimiter, hubProxyFunc);
}

module.exports = {
    registerProxyRoutes,
    getRequestTimeoutMs,
    createTimeoutController,
};
