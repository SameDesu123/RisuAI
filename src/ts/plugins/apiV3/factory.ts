type MsgType =
    | 'CALL_ROOT'
    | 'CALL_INSTANCE'
    | 'INVOKE_CALLBACK'
    | 'CALLBACK_RETURN'
    | 'RESPONSE'
    | 'RELEASE_INSTANCE'
    | 'ABORT_SIGNAL';

interface RpcMessage {
    type: MsgType;
    reqId?: string;
    id?: string;
    method?: string;
    args?: any[];
    result?: any;
    error?: string;
    abortId?: string;
}

interface RemoteRef {
    __type: 'REMOTE_REF';
    id: string;
}

interface CallbackRef {
    __type: 'CALLBACK_REF';
    id: string;
}

interface AbortSignalRef {
    __type: 'ABORT_SIGNAL_REF';
    abortId: string;
    aborted: boolean;
}

type PluginRuntimeKind = 'iframe' | 'worker';

type PluginRuntimeTiming = {
    runtime: PluginRuntimeKind;
    direction: 'host' | 'callback';
    method: string;
    duration: number;
}

type PluginRuntimeHostOptions = {
    onTiming?: (timing: PluginRuntimeTiming) => void;
}

const makeGuestBridgeScript = (runtime: PluginRuntimeKind) => `
await (async function() {
    const pendingRequests = new Map();
    const callbackRegistry = new Map();
    const callbackIdByFunction = new WeakMap();
    const proxyRefRegistry = new Map();
    const abortControllers = new Map();

    function serializeArg(arg) {
        if (typeof arg === 'function') {
            const existingId = callbackIdByFunction.get(arg);
            if (existingId) {
                return { __type: 'CALLBACK_REF', id: existingId };
            }
            const id = 'cb_' + Math.random().toString(36).substring(2);
            callbackRegistry.set(id, arg);
            callbackIdByFunction.set(arg, id);
            return { __type: 'CALLBACK_REF', id: id };
        }
        if (arg && typeof arg === 'object') {
            const refId = proxyRefRegistry.get(arg);
            if (refId) {
                return { __type: 'REMOTE_REF', id: refId };
            }
            if (arg.constructor === Object) {
                let out = null;
                for (const [key, val] of Object.entries(arg)) {
                    if (val instanceof AbortSignal) {
                        if (!out) out = { ...arg };
                        const abortId = 'abort_' + Math.random().toString(36).substring(2);

                        if (!val.aborted) {
                            val.addEventListener('abort', () => {
                                send({ type: 'ABORT_SIGNAL', abortId });
                            }, { once: true });
                        }

                        out[key] = { __type: 'ABORT_SIGNAL_REF', abortId, aborted: val.aborted };
                    }
                }
                if (out) return out;
            }
        }
        return arg;
    }

    function deserializeResult(val) {
        if (val && typeof val === 'object' && val.__type === 'REMOTE_REF') {
            const proxy = new Proxy({}, {
                get: (target, prop) => {
                    if (prop === 'then') return undefined;
                    if (prop === 'release') {
                        return () => send({ type: 'RELEASE_INSTANCE', id: val.id });
                    }
                    return (...args) => sendRequest('CALL_INSTANCE', {
                        id: val.id,
                        method: prop,
                        args: args
                    });
                }
            });
            // Store the mapping so we can serialize it back
            proxyRefRegistry.set(proxy, val.id);
            return proxy;
        }
        if (val && typeof val === 'object' && val.__type === 'CALLBACK_STREAMS') {
            //specialType, one of
            // - Response
            // - none
            const specialType = val.__specialType;
            if (specialType === 'Response') {
                return new Response(val.value, val.init);
            }
            return val.value;
        }
        return val;
    }

    function collectTransferables(obj, transferables = []) {
        if (!obj || typeof obj !== 'object') return transferables;

        if (obj instanceof ArrayBuffer ||
            obj instanceof MessagePort ||
            obj instanceof ImageBitmap ||
            (typeof OffscreenCanvas !== 'undefined' && obj instanceof OffscreenCanvas)) {
            transferables.push(obj);
        }
        else if (ArrayBuffer.isView(obj) && obj.buffer instanceof ArrayBuffer) {
            transferables.push(obj.buffer);
        }
        else if (Array.isArray(obj)) {
            obj.forEach(item => collectTransferables(item, transferables));
        }
        else if (obj.constructor === Object) {
            Object.values(obj).forEach(value => collectTransferables(value, transferables));
        }

        return transferables;
    }

    const runtimeGlobal = globalThis;
    const runtimeTarget = ${runtime === 'iframe' ? 'window' : 'self'};
    const sendTarget = ${runtime === 'iframe' ? 'window.parent' : 'self'};

    function send(payload, transferables = []) {
        ${runtime === 'iframe'
            ? "sendTarget.postMessage(payload, '*', transferables);"
            : "sendTarget.postMessage(payload, transferables);"
        }
    }

    function sendRequest(type, payload) {
        return new Promise((resolve, reject) => {
            const reqId = Math.random().toString(36).substring(7);
            pendingRequests.set(reqId, { resolve, reject });


            if (payload.args) {
                payload.args = payload.args.map(serializeArg);
            }

            const message = { type: type, reqId: reqId, ...payload };
            const transferables = collectTransferables(message);
            send(message, transferables);
        });
    }

    
    
    
    runtimeTarget.addEventListener('message', async (event) => {
        const data = event.data;
        if (!data) return;


        if (data.type === 'RESPONSE' && data.reqId) {
            const req = pendingRequests.get(data.reqId);
            if (req) {
                if (data.error) req.reject(new Error(data.error));
                else req.resolve(deserializeResult(data.result));
                pendingRequests.delete(data.reqId);
            }
        }

        else if (data.type === 'EXECUTE_CODE' && data.reqId) {
            const response = { type: 'EXEC_RESULT', reqId: data.reqId };
            try {
                const result = await eval('(async () => {' + data.code + '})()');
                response.result = result;
            } catch (e) {
                response.error = e.message || String(e);
            }
            send(response);
        }

        else if (data.type === 'ABORT_SIGNAL' && data.abortId) {
            const controller = abortControllers.get(data.abortId);
            if (controller) {
                controller.abort();
                abortControllers.delete(data.abortId);
            }
        }

        else if (data.type === 'INVOKE_CALLBACK' && data.id) {
            const fn = callbackRegistry.get(data.id);
            const response = { type: 'CALLBACK_RETURN', reqId: data.reqId };
            const usedAbortIds = [];

            try {
                if (!fn) throw new Error("Callback not found or released");
                const deserializedArgs = (data.args || []).map(function(a) {
                    if (a && typeof a === 'object' && a.__type === 'ABORT_SIGNAL_REF') {
                        const controller = new AbortController();
                        abortControllers.set(a.abortId, controller);
                        usedAbortIds.push(a.abortId);
                        if (a.aborted) { controller.abort(); }
                        return controller.signal;
                    }
                    return a;
                });
                const result = await fn(...deserializedArgs);
                response.result = result;
            } catch (e) {
                response.error = e.message || "Guest callback error";
            }
            // Clean up abort controllers after callback completes
            for (const id of usedAbortIds) {
                abortControllers.delete(id);
            }
            const transferables = collectTransferables(response);
            send(response, transferables);
        }
    });





    const propertyCache = new Map();

    runtimeGlobal.risuai = new Proxy({}, {
        get: (target, prop) => {
            if (propertyCache.has(prop)) {
                return propertyCache.get(prop);
            }
            return (...args) => sendRequest('CALL_ROOT', { method: prop, args: args });
        }
    });
    runtimeGlobal.Risuai = runtimeGlobal.risuai;
    if (!runtimeGlobal.window) {
        runtimeGlobal.window = runtimeGlobal;
    }

    try {
        // Initialize cached properties
        const propsToInit = await runtimeGlobal.risuai._getPropertiesForInitialization();
        console.log('Initializing risuai properties:', JSON.stringify(propsToInit.list));
        for (let i = 0; i < propsToInit.list.length; i++) {
            const key = propsToInit.list[i];
            const value = propsToInit[key];
            propertyCache.set(key, value);
        }

        // Initialize aliases
        const aliases = await runtimeGlobal.risuai._getAliases();
        const aliasKeys = Object.keys(aliases);
        for (let i = 0; i < aliasKeys.length; i++) {
            const aliasKey = aliasKeys[i];
            const childrens = Object.keys(aliases[aliasKey]);
            const aliasObj = {};
            for (let j = 0; j < childrens.length; j++) {
                const childKey = childrens[j];
                aliasObj[childKey] = risuai[aliases[aliasKey][childKey]];
            }
            propertyCache.set(aliasKey, aliasObj);
        }

        // Initialize helper functions defined in the guest

        propertyCache.set('unwarpSafeArray', async (safeArray) => {
            const length = await safeArray.length();
            const result = [];
            for (let i = 0; i < length; i++) {
                const item = await safeArray.at(i);
                result.push(item);
            }
            return result;
        });
    } catch (e) {
        console.error('Failed to initialize risuai properties:', e);
    }

    runtimeGlobal.initOldApiGlobal = () => {
        const keys = risuai._getOldKeys()
        for(const key of keys){
            runtimeGlobal[key] = risuai[key];
        }
    }

    Object.freeze(runtimeGlobal.postMessage);
})();
`;

const GUEST_BRIDGE_SCRIPT = makeGuestBridgeScript('iframe');
const WORKER_BRIDGE_SCRIPT = makeGuestBridgeScript('worker');

abstract class PluginRuntimeHost {
    private apiFactory: any;
    private runtime: PluginRuntimeKind;
    private options: PluginRuntimeHostOptions;

    private instanceRegistry = new Map<string, any>();
    private abortControllers = new Map<string, AbortController>();
    private callbackWrapperCache = new Map<string, Function>();

    private pendingCallbacks = new Map<string, { resolve: Function, reject: Function }>();

    constructor(apiFactory: any, runtime: PluginRuntimeKind, options: PluginRuntimeHostOptions = {}) {
        this.apiFactory = apiFactory;
        this.runtime = runtime;
        this.options = options;
    }

    protected abstract postMessage(message: any, transferables?: Transferable[]): void;

    private collectTransferables(obj: any, transferables: Transferable[] = []): Transferable[] {
        if (!obj || typeof obj !== 'object') return transferables;

        if (obj instanceof ArrayBuffer ||
            obj instanceof MessagePort ||
            obj instanceof ImageBitmap ||
            obj instanceof ReadableStream ||
            obj instanceof WritableStream ||
            obj instanceof TransformStream ||
            (typeof OffscreenCanvas !== 'undefined' && obj instanceof OffscreenCanvas)) {
            transferables.push(obj);
        }
        else if (ArrayBuffer.isView(obj) && obj.buffer instanceof ArrayBuffer) {
            transferables.push(obj.buffer);
        }
        else if (Array.isArray(obj)) {
            obj.forEach(item => this.collectTransferables(item, transferables));
        }
        else if (obj.constructor === Object) {
            Object.values(obj).forEach(value => this.collectTransferables(value, transferables));
        }

        return transferables;
    }


    private serialize(val: any): any {
        if (
            val &&
            (typeof val === 'object' || typeof val === 'function') &&
            val.__classType === 'REMOTE_REQUIRED'
        ) {
            if (val === null) return null;
            if (Array.isArray(val)) return val;


            const id = 'ref_' + Math.random().toString(36).substring(2);
            this.instanceRegistry.set(id, val);
            return { __type: 'REMOTE_REF', id } as RemoteRef;
        }

        if(val instanceof Response) {
            return {
                __type: 'CALLBACK_STREAMS',
                __specialType: 'Response',
                value: val.body,
                init: {
                    status: val.status,
                    statusText: val.statusText,
                    headers: Array.from(val.headers.entries())
                }
            };
        }

        if(
            val instanceof ReadableStream
            || val instanceof WritableStream
            || val instanceof TransformStream
        ) {
            return {
                __type: 'CALLBACK_STREAMS',
                __specialType: 'none',
                value: val
            };
        }
        return val;
    }


    private deserializeArgs(args: any[], usedAbortIds?: string[]) {
        return args.map(arg => {
            if (arg && arg.__type === 'CALLBACK_REF') {
                const cbRef = arg as CallbackRef;

                const cached = this.callbackWrapperCache.get(cbRef.id);
                if (cached) return cached;

                const wrapper = async (...innerArgs: any[]) => {
                    const started = performance.now();
                    return new Promise((resolve, reject) => {
                        const reqId = 'cb_req_' + Math.random().toString(36).substring(2);
                        this.pendingCallbacks.set(reqId, {
                            resolve: (value: any) => {
                                this.reportTiming('callback', cbRef.id, started);
                                resolve(value);
                            },
                            reject: (error: any) => {
                                this.reportTiming('callback', cbRef.id, started);
                                reject(error);
                            }
                        });

                        // AbortSignal cannot be structured-cloned for postMessage.
                        // Convert to a serializable ref and forward abort events
                        // via a separate ABORT_SIGNAL message.
                        const sanitizedArgs = innerArgs.map(arg => {
                            if (arg instanceof AbortSignal) {
                                const abortId = 'abort_' + Math.random().toString(36).substring(2);
                                const ref: AbortSignalRef = {
                                    __type: 'ABORT_SIGNAL_REF',
                                    abortId,
                                    aborted: arg.aborted
                                };
                                if (!arg.aborted) {
                                    arg.addEventListener('abort', () => {
                                    try {
                                        this.postMessage({
                                            type: 'ABORT_SIGNAL',
                                            abortId
                                        } as RpcMessage);
                                    } catch (_) { /* iframe already removed */ }
                                }, { once: true });
                            }
                                return ref;
                            }
                            return arg;
                        });

                        const message = {
                            type: 'INVOKE_CALLBACK',
                            id: cbRef.id,
                            reqId,
                            args: sanitizedArgs
                        };
                        const transferables = this.collectTransferables(message);
                        this.postMessage(message, transferables);
                    });
                };
                this.callbackWrapperCache.set(cbRef.id, wrapper);
                return wrapper;
            }
            if (arg && arg.__type === 'REMOTE_REF') {
                const remoteRef = arg as RemoteRef;
                const instance = this.instanceRegistry.get(remoteRef.id);
                if (instance) {
                    return instance;
                }
            }
            if (arg && typeof arg === 'object' && arg.constructor === Object) {
                let out: any = null;
                for (const [key, val] of Object.entries<any>(arg)) {
                    if (val && val.__type === 'ABORT_SIGNAL_REF') {
                        if (!out) out = { ...arg };
                        const abortRef = val as AbortSignalRef, controller = new AbortController();

                        if (abortRef.aborted) controller.abort();
                        else this.abortControllers.set(abortRef.abortId, controller);

                        usedAbortIds?.push(abortRef.abortId);
                        out[key] = controller.signal;
                    }
                }
                if (out) return out;
            }
            return arg;
        });
    }

    protected async handleMessageData(data: RpcMessage) {
        if (data.type === 'CALLBACK_RETURN') {
            const req = this.pendingCallbacks.get(data.reqId!);
            if (req) {
                if (data.error) req.reject(new Error(data.error));
                else req.resolve(data.result);
                this.pendingCallbacks.delete(data.reqId!);
            }
            return;
        }

        if (data.type === 'ABORT_SIGNAL') {
            const controller = this.abortControllers.get(data.abortId!);
            if (controller) {
                controller.abort();
                this.abortControllers.delete(data.abortId!);
            }
            return;
        }


        if (data.type === 'RELEASE_INSTANCE') {
            this.instanceRegistry.delete(data.id!);
            return;
        }


        if (data.type === 'CALL_ROOT' || data.type === 'CALL_INSTANCE') {
            const response: RpcMessage = { type: 'RESPONSE', reqId: data.reqId };
            const usedAbortIds: string[] = [];
            const started = performance.now();
            const methodName = data.type === 'CALL_ROOT' ? data.method! : `${data.id}.${data.method}`;

            try {

                const args = this.deserializeArgs(data.args || [], usedAbortIds);
                let result: any;


                if (data.type === 'CALL_ROOT') {
                    const fn = this.apiFactory[data.method!];
                    if (typeof fn !== 'function') throw new Error(`API method ${data.method} not found`);
                    result = await fn(...args);
                } else {
                    const instance = this.instanceRegistry.get(data.id!);
                    if (!instance) throw new Error("Instance not found or released");
                    if (typeof instance[data.method!] !== 'function') throw new Error(`Method ${data.method} missing on instance`);
                    result = await instance[data.method!](...args);
                }


                response.result = this.serialize(result);

            } catch (err: any) {
                response.error = err.message || "Host execution error";
            } finally {
                this.reportTiming('host', methodName, started);
                for (const id of usedAbortIds) this.abortControllers.delete(id);
            }

            const transferables = this.collectTransferables(response);
            try {
                this.postMessage(response, transferables);                    
            } catch (error) {
                this.postMessage({
                    type: 'RESPONSE',
                    reqId: data.reqId,
                    error: `Failed to post message to ${this.runtime}: ` + (error as Error).message
                });
                console.error(`Failed to post message to ${this.runtime}:`, error);
            }
        }
    }

    protected clearRegistries() {
        this.instanceRegistry.clear();
        this.pendingCallbacks.clear();
        this.abortControllers.clear();
        this.callbackWrapperCache.clear();
    }

    private reportTiming(direction: PluginRuntimeTiming['direction'], method: string, started: number) {
        this.options.onTiming?.({
            runtime: this.runtime,
            direction,
            method,
            duration: performance.now() - started
        });
    }
}

export class SandboxHost extends PluginRuntimeHost {
    private iframe: HTMLIFrameElement;
    private nonce = crypto.randomUUID();
    private csp = `connect-src 'none'; script-src 'nonce-${this.nonce}' 'wasm-unsafe-eval'; frame-src 'none'; object-src 'none'; style-src * 'unsafe-inline'; default-src 'none'; img-src * data: blob:; font-src * data: blob:; media-src * data: blob:; base-uri 'none';`;
    private cleanupMessageHandler?: () => void;

    constructor(apiFactory: any, options: PluginRuntimeHostOptions = {}) {
        super(apiFactory, 'iframe', options);
    }

    public executeInIframe(code: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const reqId = 'exec_' + Math.random().toString(36).substring(2);

            const handler = (event: MessageEvent) => {
                if (event.source !== this.iframe.contentWindow) return;
                const data = event.data;

                if (data.type === 'EXEC_RESULT' && data.reqId === reqId) {
                    window.removeEventListener('message', handler);
                    if (data.error) {
                        reject(new Error(data.error));
                    } else {
                        resolve(data.result);
                    }
                }
            };

            window.addEventListener('message', handler);

            this.iframe.contentWindow?.postMessage({
                type: 'EXECUTE_CODE',
                reqId,
                code
            }, '*');
        });
    }

    protected postMessage(message: any, transferables: Transferable[] = []) {
        this.iframe.contentWindow?.postMessage(message, '*', transferables);
    }

    public run(container: HTMLElement|HTMLIFrameElement, userCode: string) {
        if(container instanceof HTMLIFrameElement) {
            this.iframe = container;
        } else {
            this.iframe = document.createElement('iframe');
            container.appendChild(this.iframe);
        }

        this.iframe.style.width = "100%";
        this.iframe.style.height = "100%";
        this.iframe.style.border = "none";

        this.iframe.style.backgroundColor = "transparent";
        this.iframe.setAttribute('allowTransparency', 'true');

        this.iframe.sandbox.add('allow-scripts');
        this.iframe.sandbox.add('allow-modals')
        this.iframe.sandbox.add('allow-downloads')

        this.iframe.setAttribute('csp', this.csp);

        const messageHandler = async (event: MessageEvent) => {
            if (event.source !== this.iframe.contentWindow) return;
            await this.handleMessageData(event.data as RpcMessage);
        };

        window.addEventListener('message', messageHandler);
        this.cleanupMessageHandler = () => window.removeEventListener('message', messageHandler);


        const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="${this.csp}" id="csp-meta">
      </head>
      <body>
        <style>
            body {
                background-color: transparent;
            }
        </style>
        <script nonce="${this.nonce}">
            document.querySelector('meta#csp-meta')?.remove();
            (async () => {
                ${GUEST_BRIDGE_SCRIPT}
                    
                (async () => {
                    ${userCode}
                })()
            })();
        </script>
      </body>
      </html>
    `;

        this.iframe.srcdoc = html;

        return () => {
            this.cleanupMessageHandler?.();
            this.iframe.remove();
            this.clearRegistries();
        };
    }

    public terminate() {
        this.cleanupMessageHandler?.();
        if (this.iframe) {
            this.iframe.remove();
        }
        this.clearRegistries();
    }
}

export class WorkerSandboxHost extends PluginRuntimeHost {
    private worker: Worker;
    private objectUrl: string;

    constructor(apiFactory: any, options: PluginRuntimeHostOptions = {}) {
        super(apiFactory, 'worker', options);
    }

    protected postMessage(message: any, transferables: Transferable[] = []) {
        this.worker?.postMessage(message, transferables);
    }

    public run(userCode: string) {
        const workerScript = `
            ${WORKER_BRIDGE_SCRIPT}

            (async () => {
                ${userCode}
            })()
        `;
        const blob = new Blob([workerScript], { type: 'text/javascript' });
        this.objectUrl = URL.createObjectURL(blob);
        this.worker = new Worker(this.objectUrl, { type: 'module' });
        this.worker.addEventListener('message', async (event) => {
            await this.handleMessageData(event.data as RpcMessage);
        });
    }

    public executeInIframe(code: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const reqId = 'exec_' + Math.random().toString(36).substring(2);
            const handler = (event: MessageEvent) => {
                const data = event.data;

                if (data.type === 'EXEC_RESULT' && data.reqId === reqId) {
                    this.worker.removeEventListener('message', handler);
                    if (data.error) {
                        reject(new Error(data.error));
                    } else {
                        resolve(data.result);
                    }
                }
            };

            this.worker.addEventListener('message', handler);
            this.worker.postMessage({
                type: 'EXECUTE_CODE',
                reqId,
                code
            });
        });
    }

    public terminate() {
        this.worker?.terminate();
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
        }
        this.clearRegistries();
    }
}
