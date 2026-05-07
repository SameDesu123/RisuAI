const { existsSync, mkdirSync, readFileSync } = require('fs');
const { savePath, passwordPath, knownPublicKeysPath } = require('./config.cjs');

function createServerState() {
    if (!existsSync(savePath)) {
        mkdirSync(savePath);
    }

    let password = '';
    if (existsSync(passwordPath)) {
        password = readFileSync(passwordPath, 'utf-8');
    }

    let knownPublicKeysHashes = [];
    if (existsSync(knownPublicKeysPath)) {
        const knownPublicKeysRaw = readFileSync(knownPublicKeysPath, 'utf-8');
        knownPublicKeysHashes = JSON.parse(knownPublicKeysRaw);
    }

    return {
        password,
        knownPublicKeysHashes,
        oauthData: {
            client_id: '',
            client_secret: '',
            config: {},
            code_verifier: ''
        },
        accessTokenCache: {
            token: null,
            expiry: 0
        },
        proxyStreamJobs: new Map(),
    };
}

module.exports = {
    createServerState,
};
