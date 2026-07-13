export type BotUiAsset = [string, string, string]

export function indexBotUiAssets(...sources: BotUiAsset[][]): Map<string, BotUiAsset> {
    const result = new Map<string, BotUiAsset>()
    for(const source of sources){
        for(const asset of source){
            const name = asset[0].toLocaleLowerCase()
            if(!result.has(name)) result.set(name, asset)
        }
    }
    return result
}
