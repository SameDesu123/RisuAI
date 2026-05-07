const express = require('express');
const app = express();
if (process.env.TRUST_PROXY) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}
const path = require('path');
const htmlparser = require('node-html-parser');
const fs = require('fs/promises')
const { createAuthHelpers, createLimiters } = require('./auth.cjs');
const { startServer } = require('./bootstrap.cjs');
const { registerOAuthRoutes } = require('./routes-oauth.cjs');
const { registerProxyRoutes } = require('./routes-proxy.cjs');
const { createProxyStreamHandlers } = require('./routes-proxy-stream.cjs');
const { registerStorageRoutes } = require('./routes-storage.cjs');
const { createServerState } = require('./state.cjs');
app.use(express.static(path.join(process.cwd(), 'dist'), {index: false}));
app.use(express.json({ limit: '100mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));
app.use(express.text({ limit: '100mb' }));

const state = createServerState();
const {
    authenticatedRouteLimiter,
    authRouteLimiter,
    loginRouteLimiter
} = createLimiters();
const {
    isHex,
    hashJSON,
    isAuthorizedProxyRequest,
    checkProxyAuth,
    checkAuth,
} = createAuthHelpers(state);
const authHelpers = {
    isHex,
    hashJSON,
    isAuthorizedProxyRequest,
    checkProxyAuth,
    checkAuth,
};
const proxyStreamHandlers = createProxyStreamHandlers({
    state,
    authHelpers,
});

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

registerProxyRoutes(app, {
    state,
    authenticatedRouteLimiter,
    authHelpers,
});
proxyStreamHandlers.registerProxyStreamRoutes(app, authenticatedRouteLimiter);

registerStorageRoutes(app, {
    state,
    authenticatedRouteLimiter,
    authRouteLimiter,
    loginRouteLimiter,
    authHelpers,
});

registerOAuthRoutes(app, state, authRouteLimiter);

(async () => {
    proxyStreamHandlers.startProxyStreamGc();
    await startServer(app, proxyStreamHandlers);
})();
