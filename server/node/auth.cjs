const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const hexRegex = /^[0-9a-fA-F]+$/;

function createLimiters() {
    return {
        authenticatedRouteLimiter: rateLimit({
            windowMs: 60 * 1000,
            max: 2000,
            standardHeaders: true,
            legacyHeaders: false,
            message: { error: 'Too many requests. Please retry shortly.' }
        }),
        authRouteLimiter: rateLimit({
            windowMs: 60 * 1000,
            max: 2000,
            standardHeaders: true,
            legacyHeaders: false,
            message: { error: 'Too many requests. Please retry shortly.' }
        }),
        loginRouteLimiter: rateLimit({
            windowMs: 30 * 1000,
            max: 10,
            standardHeaders: true,
            legacyHeaders: false,
            message: { error: 'Too many attempts. Please wait and try again later.' }
        }),
    };
}

function createAuthHelpers(state) {
    function isHex(str) {
        return hexRegex.test(str.toUpperCase().trim()) || str === '__password';
    }

    async function hashJSON(json) {
        const hash = crypto.createHash('sha256');
        hash.update(JSON.stringify(json));
        return hash.digest('hex');
    }

    function isAuthorizedRequest(req) {
        const authHeader = normalizeAuthHeader(req.headers['risu-auth']);
        return !!authHeader && authHeader.trim() === state.password.trim();
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
            if (!state.knownPublicKeysHashes.includes(pubKeyHash)) {
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

    async function checkAuth(req, res, returnOnlyStatus = false) {
        try {
            const authHeader = normalizeAuthHeader(req.headers['risu-auth']);

            if (!authHeader) {
                console.log('No auth header');
                if (returnOnlyStatus) {
                    return false;
                }
                res.status(400).send({
                    error: 'No auth header'
                });
                return false;
            }

            const [
                jsonHeaderB64,
                jsonPayloadB64,
                signatureB64,
            ] = authHeader.split('.');

            const jsonHeader = JSON.parse(Buffer.from(jsonHeaderB64, 'base64url').toString('utf-8'));
            const jsonPayload = JSON.parse(Buffer.from(jsonPayloadB64, 'base64url').toString('utf-8'));
            const signature = Buffer.from(signatureB64, 'base64url');

            const now = Math.floor(Date.now() / 1000);
            if (jsonPayload.exp < now) {
                console.log('Token expired');
                if (returnOnlyStatus) {
                    return false;
                }
                res.status(400).send({
                    error: 'Token Expired'
                });
                return false;
            }

            const pubKeyHash = await hashJSON(jsonPayload.pub);
            if (!state.knownPublicKeysHashes.includes(pubKeyHash)) {
                console.log('Unknown public key');
                if (returnOnlyStatus) {
                    return false;
                }
                res.status(400).send({
                    error: 'Unknown Public Key'
                });
                return false;
            }

            if (jsonHeader.alg !== "ES256") {
                console.log('Unsupported algorithm');
                if (returnOnlyStatus) {
                    return false;
                }
                res.status(400).send({
                    error: 'Unsupported Algorithm'
                });
                return false;
            }

            const isValid = await crypto.subtle.verify(
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

            if (!isValid) {
                console.log('Invalid signature');
                if (returnOnlyStatus) {
                    return false;
                }
                res.status(400).send({
                    error: 'Invalid Signature'
                });
                return false;
            }

            return true;
        } catch (error) {
            console.log(error);
            if (returnOnlyStatus) {
                return false;
            }
            res.status(500).send({
                error: 'Internal Server Error'
            });
            return false;
        }
    }

    return {
        isHex,
        hashJSON,
        isAuthorizedRequest,
        normalizeAuthHeader,
        isAuthorizedJwtHeader,
        isAuthorizedProxyRequest,
        checkProxyAuth,
        checkAuth,
    };
}

module.exports = {
    createAuthHelpers,
    createLimiters,
};
