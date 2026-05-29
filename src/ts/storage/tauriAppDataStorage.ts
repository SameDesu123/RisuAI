import {
    BaseDirectory,
    exists,
    mkdir,
    readDir,
    readFile,
    remove,
    writeFile
} from "@tauri-apps/plugin-fs"

const storageDir = "storage"

function encodeKey(key: string) {
    return Buffer.from(key, "utf-8").toString("hex")
}

function decodeKey(fileName: string) {
    return Buffer.from(fileName, "hex").toString("utf-8")
}

function isHexFileName(fileName: string) {
    return fileName.length > 0 && fileName.length % 2 === 0 && /^[0-9a-f]+$/i.test(fileName)
}

export class TauriAppDataStorage {
    async setItem(key: string, value: Uint8Array) {
        await this.Init()
        await writeFile(`${storageDir}/${encodeKey(key)}`, value, {
            baseDir: BaseDirectory.AppData
        })
    }

    async getItem(key: string): Promise<Buffer | null> {
        await this.Init()
        const filePath = `${storageDir}/${encodeKey(key)}`
        if (!(await exists(filePath, { baseDir: BaseDirectory.AppData }))) {
            return null
        }
        return Buffer.from(await readFile(filePath, { baseDir: BaseDirectory.AppData }))
    }

    async keys(): Promise<string[]> {
        await this.Init()
        const entries = await readDir(storageDir, { baseDir: BaseDirectory.AppData })
        return entries
            .map((entry) => entry.name)
            .filter(isHexFileName)
            .map(decodeKey)
    }

    async removeItem(key: string): Promise<void | null> {
        await this.Init()
        const filePath = `${storageDir}/${encodeKey(key)}`
        if (!(await exists(filePath, { baseDir: BaseDirectory.AppData }))) {
            return null
        }
        await remove(filePath, { baseDir: BaseDirectory.AppData })
    }

    private async Init() {
        if (!(await exists(storageDir, { baseDir: BaseDirectory.AppData }))) {
            await mkdir(storageDir, {
                recursive: true,
                baseDir: BaseDirectory.AppData
            })
        }
    }

    listItem = this.keys
}
