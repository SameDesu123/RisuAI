export type RisuStorageKey = string

export type RisuStorageReadableValue = unknown

export type RisuStorageWritableValue = Uint8Array

export type RisuStorageKeyList = string[] | Promise<string[]>

export interface RisuRawStorage {
    setItem(key: RisuStorageKey, value: RisuStorageWritableValue): Promise<unknown>
    getItem(key: RisuStorageKey): Promise<RisuStorageReadableValue>
    keys(): RisuStorageKeyList
    removeItem(key: RisuStorageKey): Promise<unknown> | unknown
    listItem?: () => RisuStorageKeyList
}
