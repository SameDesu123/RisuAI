const path = require('path');
const crypto = require('crypto');
const { existsSync, writeFileSync } = require('fs');
const fs = require('fs/promises');
const { savePath, passwordPath, knownPublicKeysPath } = require('./config.cjs');

function registerStorageRoutes(app, arg) {
    const {
        state,
        authenticatedRouteLimiter,
        authRouteLimiter,
        loginRouteLimiter,
        authHelpers,
    } = arg;
    const { checkAuth, hashJSON, isHex } = authHelpers;

    app.get('/api/test_auth', authRouteLimiter, async(req, res) => {

        if(!state.password){
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
        if(state.password === ''){
            res.status(400).send({error: 'Password not set'})
            return;
        }
        if(req.body.password && req.body.password.trim() === state.password.trim()){
            state.knownPublicKeysHashes.push(await hashJSON(req.body.publicKey))
            writeFileSync(knownPublicKeysPath, JSON.stringify(state.knownPublicKeysHashes), 'utf-8')
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
        if(state.password === ''){
            state.password = req.body.password
            writeFileSync(passwordPath, state.password, 'utf-8')
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
        const filePaths = req.headers['file-path']?.split('$$') || []

        for(const filePath of filePaths){
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
}

module.exports = {
    registerStorageRoutes,
};
