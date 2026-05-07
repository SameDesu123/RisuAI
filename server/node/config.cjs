const path = require('path');

const savePath = path.join(process.cwd(), 'save');
const passwordPath = path.join(process.cwd(), 'save', '__password');
const knownPublicKeysPath = path.join(process.cwd(), 'save', '__known_public_key_hashes.json');
const authCodePath = path.join(process.cwd(), 'save', '__authcode');
const sslPath = path.join(process.cwd(), 'server/node/ssl/certificate');
const hubURL = 'https://sv.risuai.xyz';

const proxyStreamConfig = {
    defaultTimeoutMs: 600000,
    maxTimeoutMs: 3600000,
    defaultHeartbeatSec: 15,
    heartbeatMinSec: 5,
    heartbeatMaxSec: 60,
    gcIntervalMs: 60000,
    doneGraceMs: 30000,
    maxActiveJobs: 64,
    maxPendingEvents: 512,
    maxPendingBytes: 2 * 1024 * 1024,
    maxBodyBase64Bytes: 8 * 1024 * 1024,
};

module.exports = {
    savePath,
    passwordPath,
    knownPublicKeysPath,
    authCodePath,
    sslPath,
    hubURL,
    proxyStreamConfig,
};
