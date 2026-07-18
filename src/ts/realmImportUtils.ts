export type RealmCharacterResponseKind = 'png' | 'charx' | 'structured'

export function classifyRealmCharacterResponse(contentType: string | null): RealmCharacterResponseKind {
    const mediaType = (contentType ?? '').split(';', 1)[0].trim().toLowerCase()
    if(mediaType === 'image/png'){
        return 'png'
    }
    if(mediaType === 'application/zip' || mediaType === 'application/charx'){
        return 'charx'
    }
    return 'structured'
}

export async function getResponseStreamOrBytes(response: Pick<Response, 'body' | 'arrayBuffer'>): Promise<ReadableStream<Uint8Array> | Uint8Array> {
    if(response.body){
        return response.body
    }
    return new Uint8Array(await response.arrayBuffer())
}

export function getRealmResponseError(status: number, body: string): string {
    let message = body.trim()
    if(message){
        try {
            const parsed = JSON.parse(message)
            if(typeof parsed?.message === 'string'){
                message = parsed.message
            }
            else if(typeof parsed?.error === 'string'){
                message = parsed.error
            }
        }
        catch {
            // Keep non-JSON server responses verbatim.
        }
    }
    const prefix = `Realm download failed (HTTP ${status})`
    return message ? `${prefix}: ${message}` : prefix
}

export function isPendingRealmUpload(status: number, message: string): boolean {
    return status === 404 && /still uploading|upload(?:ing)?|업로드/i.test(message)
}
