import { getDatabase } from 'src/ts/storage/database.svelte'

export function isVercelGatewayModel(aiModel?: string): boolean {
    return aiModel === 'vercel'
}

function normalizeProviderList(providers: string[]): string[] {
    const normalized = providers.map((provider) => provider.trim()).filter(Boolean)
    return [...new Set(normalized)]
}

export function applyVercelGatewayOptions<T extends Record<string, any>>(body: T, aiModel?: string): T {
    if(!isVercelGatewayModel(aiModel)) return body

    const config = getDatabase().vercelGateway
    const requestBody = body as Record<string, any>
    const gateway: Record<string, any> = {}
    const order = normalizeProviderList(config.order ?? [])
    const only = normalizeProviderList(config.only ?? [])

    if(order.length > 0) gateway.order = order
    if(only.length > 0) gateway.only = only
    if(config.sort && config.sort !== 'auto') gateway.sort = config.sort
    if(config.serviceTier && config.serviceTier !== 'default') gateway.serviceTier = config.serviceTier
    if(config.zeroDataRetention) gateway.zeroDataRetention = true
    if(config.disallowPromptTraining) gateway.disallowPromptTraining = true
    if(config.automaticCaching) gateway.caching = 'auto'

    if(Object.keys(gateway).length > 0){
        requestBody.providerOptions ??= {}
        requestBody.providerOptions.gateway = gateway
    }
    else if(requestBody.providerOptions?.gateway){
        delete requestBody.providerOptions.gateway
        if(Object.keys(requestBody.providerOptions).length === 0) delete requestBody.providerOptions
    }

    return body
}

export function getVercelGatewayRequestModel(aiModel?: string): string | undefined {
    return isVercelGatewayModel(aiModel) ? getDatabase().vercelRequestModel : undefined
}

export function getVercelGatewayAPIKey(aiModel?: string): string | undefined {
    return isVercelGatewayModel(aiModel) ? getDatabase().vercelAIKey : undefined
}

export const __testVercelGateway = {
    normalizeProviderList,
}
