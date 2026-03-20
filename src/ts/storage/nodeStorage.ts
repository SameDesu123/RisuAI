import { language } from "src/lang"
import { alertError, alertInput, waitAlert } from "../alert"
import { base64url, getKeypairStore, saveKeypairStore } from "../util"


export type DiffSaveManifest = {
    version: number
    blocks: Record<string, { hash: string, size: number }>
    exists: boolean
}

export class NodeStorage{

    authChecked = false
    private _diffSaveSupported: boolean | null = null
    private _jsonPatchSupported: boolean | null = null
    JSONStringlifyAndbase64Url(obj:any){
        return base64url(Buffer.from(JSON.stringify(obj), 'utf-8'))
    }

    async createAuth(){
        const keyPair = await this.getKeyPair()
        const date = Math.floor(Date.now() / 1000)
        
        const header = {
            alg: "ES256",
            typ: "JWT",   
        }
        const payload = {
            iat: date,
            exp: date + 5 * 60, //5 minutes expiration
            pub: await crypto.subtle.exportKey('jwk', keyPair.publicKey)
        }
        const sig = await crypto.subtle.sign(
            {
                name: "ECDSA",
                hash: "SHA-256"
            },
            keyPair.privateKey,
            Buffer.from(
                this.JSONStringlifyAndbase64Url(header) + "." + this.JSONStringlifyAndbase64Url(payload)
            )
        )
        const sigString = base64url(new Uint8Array(sig))
        return this.JSONStringlifyAndbase64Url(header) + "." + this.JSONStringlifyAndbase64Url(payload) + "." + sigString
    }

    async getKeyPair():Promise<CryptoKeyPair>{
        
        const storedKey = await getKeypairStore('node')

        if(storedKey){
            return storedKey
        }

        const keyPair = await crypto.subtle.generateKey(
            {
                name: "ECDSA",
                namedCurve: "P-256"
            },
            false,
            ["sign", "verify"],
        );

        await saveKeypairStore('node', keyPair)

        return keyPair

    }

    async setItem(key:string, value:Uint8Array) {
        await this.checkAuth()
        const da = await fetch('/api/write', {
            method: "POST",
            body: value as any,
            headers: {
                'content-type': 'application/octet-stream',
                'file-path': Buffer.from(key, 'utf-8').toString('hex'),
                'risu-auth': await this.createAuth()
            }
        })
        if(da.status < 200 || da.status >= 300){
            throw "setItem Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
    }
    async getItem(key:string):Promise<Buffer> {
        await this.checkAuth()
        const da = await fetch('/api/read', {
            method: "GET",
            headers: {
                'file-path': Buffer.from(key, 'utf-8').toString('hex'),
                'risu-auth': await this.createAuth()
            }
        })
        if(da.status < 200 || da.status >= 300){
            throw "getItem Error"
        }

        const data = Buffer.from(await da.arrayBuffer())
        if (data.length == 0){
            return null
        }
        return data
    }
    async keys():Promise<string[]>{
        await this.checkAuth()
        const da = await fetch('/api/list', {
            method: "GET",
            headers:{
                'risu-auth': await this.createAuth()
            }
        })
        if(da.status < 200 || da.status >= 300){
            throw "listItem Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
        return data.content
    }
    async removeItem(key:string){
        await this.checkAuth()
        const da = await fetch('/api/remove', {
            method: "GET",
            headers: {
                'file-path': Buffer.from(key, 'utf-8').toString('hex'),
                'risu-auth': await this.createAuth()
            }
        })
        if(da.status < 200 || da.status >= 300){
            throw "removeItem Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
    }

    async supportsDiffSave(): Promise<boolean> {
        if (this._diffSaveSupported !== null) return this._diffSaveSupported;
        try {
            const res = await fetch('/api/save-capabilities');
            if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
                const data = await res.json();
                this._diffSaveSupported = !!data.diffSave;
                this._jsonPatchSupported = !!data.jsonPatch;
            } else {
                this._diffSaveSupported = false;
                this._jsonPatchSupported = false;
            }
        } catch {
            this._diffSaveSupported = false;
            this._jsonPatchSupported = false;
        }
        return this._diffSaveSupported;
    }

    async supportsJsonPatch(): Promise<boolean> {
        if (this._jsonPatchSupported !== null) return this._jsonPatchSupported;
        await this.supportsDiffSave(); // populates both flags
        return this._jsonPatchSupported ?? false;
    }

    async saveJsonPatch(
        patches: Record<string, any[]>,
        deletedBlocks: string[],
        expectedHashes: Record<string, string>,
        manifestVersion: number
    ): Promise<DiffSaveManifest & { rejected?: string[] }> {
        await this.checkAuth();

        const body = JSON.stringify({
            patches,
            expectedHashes,
            deletedBlocks,
            manifestVersion
        });

        const res = await fetch('/api/save-json-patch', {
            method: 'POST',
            body,
            headers: {
                'content-type': 'application/json',
                'risu-auth': await this.createAuth()
            }
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(err.error || 'saveJsonPatch failed');
        }
        return await res.json();
    }

    async getManifest(): Promise<DiffSaveManifest> {
        await this.checkAuth();
        const res = await fetch('/api/save-manifest', {
            headers: { 'risu-auth': await this.createAuth() }
        });
        if (!res.ok) throw new Error('getManifest failed');
        return await res.json();
    }

    async saveDiff(
        changedBlocks: Record<string, { hash: string, data: Uint8Array }>,
        deletedBlocks: string[],
        clientManifestVersion: number
    ): Promise<DiffSaveManifest> {
        await this.checkAuth();

        const header = JSON.stringify({
            changedBlocks: Object.fromEntries(
                Object.entries(changedBlocks).map(([name, { hash, data }]) =>
                    [name, { hash, size: data.length }]
                )
            ),
            deletedBlocks,
            clientManifestVersion
        });
        const headerBuf = new TextEncoder().encode(header);

        // Calculate total size
        let totalBlockSize = 0;
        for (const [name, { data }] of Object.entries(changedBlocks)) {
            const nameBuf = new TextEncoder().encode(name);
            totalBlockSize += 2 + nameBuf.length + 4 + data.length;
        }

        const payload = new Uint8Array(4 + headerBuf.length + totalBlockSize);
        const view = new DataView(payload.buffer);
        let offset = 0;

        // Header length + header
        view.setUint32(offset, headerBuf.length, true); offset += 4;
        payload.set(headerBuf, offset); offset += headerBuf.length;

        // Block data
        for (const [name, { data }] of Object.entries(changedBlocks)) {
            const nameBuf = new TextEncoder().encode(name);
            view.setUint16(offset, nameBuf.length, true); offset += 2;
            payload.set(nameBuf, offset); offset += nameBuf.length;
            view.setUint32(offset, data.length, true); offset += 4;
            payload.set(data, offset); offset += data.length;
        }

        const res = await fetch('/api/save-diff', {
            method: 'POST',
            body: payload,
            headers: {
                'content-type': 'application/octet-stream',
                'risu-auth': await this.createAuth()
            }
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(err.error || 'saveDiff failed');
        }
        return await res.json();
    }

    async getBlocks(names: string[]): Promise<Record<string, Uint8Array>> {
        await this.checkAuth();
        const res = await fetch('/api/save-blocks', {
            method: 'POST',
            headers: {
                'risu-auth': await this.createAuth(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({ names })
        });
        if (!res.ok) throw new Error('getBlocks failed');

        const buf = new Uint8Array(await res.arrayBuffer());
        const result: Record<string, Uint8Array> = {};
        let offset = 0;
        const dv = new DataView(buf.buffer);
        while (offset + 2 <= buf.length) {
            const nameLen = dv.getUint16(offset, true); offset += 2;
            if (offset + nameLen > buf.length) break;
            const name = new TextDecoder().decode(buf.subarray(offset, offset + nameLen)); offset += nameLen;
            if (offset + 4 > buf.length) break;
            const dataLen = dv.getUint32(offset, true); offset += 4;
            if (offset + dataLen > buf.length) break;
            result[name] = buf.slice(offset, offset + dataLen); offset += dataLen;
        }
        return result;
    }

    private async checkAuth(){

        if(!this.authChecked){
            let data: any;
            try {
                const res = await fetch('/api/test_auth',{
                    headers: {
                        'risu-auth': await this.createAuth()
                    }
                });
                
                if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
                    throw new Error("Node server API unavailable or returned HTML. Check your backend configuration.");
                }
                data = await res.json();
            } catch (error) {
                console.error("NodeStorage checkAuth failed:", error);
                throw error;
            }

            if(data.status === 'unset'){
                const input = await digestPassword(await alertInput(language.setNodePassword))
                await fetch('/api/set_password',{
                    method: "POST",
                    body:JSON.stringify({
                        password: input 
                    }),
                    headers: {
                        'content-type': 'application/json'
                    }
                })
                return await this.createAuth()
            }
            else if(data.status === 'incorrect'){
                const keypair = await this.getKeyPair()
                const publicKey = await crypto.subtle.exportKey('jwk', keypair.publicKey)
                const input = await digestPassword(await alertInput(language.inputNodePassword))

                const s = await fetch('/api/login',{
                    method: "POST",
                    body: JSON.stringify({
                        password: input,
                        publicKey: publicKey
                    }),
                    headers: {
                        'content-type': 'application/json'
                    }
                })

                //too many requests
                if(s.status === 429){
                    alertError(`Too many attempts. Please wait and try again later.`)
                    await waitAlert()
                }
                

                return await this.createAuth()
            
            }
            else{
                this.authChecked = true
            }
        }
    }

    listItem = this.keys
}

async function digestPassword(message:string) {
    const crypt = await (await fetch('/api/crypto', {
        body: JSON.stringify({
            data: message
        }),
        headers: {
            'content-type': 'application/json'
        },
        method: "POST"
    })).text()
    
    return crypt;
}