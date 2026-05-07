const { writeFileSync } = require('fs');
const openid = require('openid-client');
const { authCodePath } = require('./config.cjs');

function registerOAuthRoutes(app, state) {
    app.get('/api/oauth_login', async (req, res) => {
        const redirect_uri = (new URL (req.url)).host + '/api/oauth_callback'

        if(!redirect_uri){
            res.status(400).send({ error: 'redirect_uri is required' });
            return
        }
        if(!state.oauthData.client_id || !state.oauthData.client_secret){
            const discovery = await openid.discovery('https://account.sionyw.com/','','');
            state.oauthData.config = discovery;

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
                    client_id: state.oauthData.client_id,
                    client_secret: state.oauthData.client_secret,
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
                state.oauthData.client_id = registrationData.client_id;
                state.oauthData.client_secret = registrationData.client_secret;
                discovery.clientMetadata().client_id = state.oauthData.client_id;
                discovery.clientMetadata().client_secret = state.oauthData.client_secret;
            }
            else{
                console.error('[Server] OAuth2 dynamic client registration failed:', registrationResponse.statusText);
                res.status(500).send({ error: 'OAuth2 client registration failed' });
                return
            }


            //now lets request

            let code_verifier = openid.randomPKCECodeVerifier();
            let code_challenge = await openid.calculatePKCECodeChallenge(code_verifier);

            state.oauthData.code_verifier = code_verifier;
            let redirectTo = openid.buildAuthorizationUrl(state.oauthData.config, {
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
        if(!state.oauthData.client_id || !state.oauthData.client_secret || !state.oauthData.code_verifier){
            res.status(400).send({ error: 'OAuth2 not initialized' });
            return
        }

        let tokens = await openid.authorizationCodeGrant(
            state.oauthData.config,
            getCurrentUrl(),
            {
                pkceCodeVerifier: state.oauthData.code_verifier,
            },
        )

        writeFileSync(authCodePath, tokens.access_token, 'utf-8')

        res.send(tokens)

    })
}

module.exports = {
    registerOAuthRoutes,
};
