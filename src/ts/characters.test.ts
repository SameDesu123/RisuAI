import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    saveImage: vi.fn(),
    readImage: vi.fn(),
    getFileSrc: vi.fn(),
    hasher: vi.fn(),
    dbState: {
        db: {
            hideAllImages: false,
            characters: [],
        } as any,
    },
}))

vi.mock('./storage/database.svelte', () => ({
    saveImage: (...args: any[]) => mocks.saveImage(...args),
    defaultSdDataFunc: vi.fn(),
    getDatabase: vi.fn(() => mocks.dbState.db),
    getCharacterByIndex: vi.fn(),
    setCharacterByIndex: vi.fn(),
}))

vi.mock('./stores.svelte', () => ({
    DBState: mocks.dbState,
    MobileGUIStack: { set: vi.fn() },
    OpenRealmStore: { set: vi.fn() },
    selectedCharID: { set: vi.fn(), subscribe: vi.fn() },
}))

vi.mock('./globalApi.svelte', () => ({
    AppendableBuffer: class AppendableBuffer {},
    changeChatTo: vi.fn(),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    getFileSrc: (...args: any[]) => mocks.getFileSrc(...args),
    readImage: (...args: any[]) => mocks.readImage(...args),
    requiresFullEncoderReload: { state: false },
}))

vi.mock('./util', () => ({
    asBuffer: (arr: Uint8Array) => arr,
    checkNullish: (data: any) => data === undefined || data === null,
    findCharacterbyId: vi.fn(),
    getUserName: vi.fn(),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
}))

vi.mock('./parser/parser.svelte', () => ({
    hasher: (...args: any[]) => mocks.hasher(...args),
    parseMarkdownSafe: (value: string) => value,
}))

vi.mock('./alert', () => ({
    alertAddCharacter: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: {},
    alertWait: vi.fn(),
}))

vi.mock('../lang', () => ({ language: {} }))
vi.mock('./media', () => ({ getImageType: vi.fn(() => 'PNG') }))
vi.mock('./process/inlayScreen', () => ({ updateInlayScreen: vi.fn() }))
vi.mock('./translator/translator', () => ({ translateHTML: vi.fn() }))
vi.mock('./process/index.svelte', () => ({ doingChat: { state: false } }))
vi.mock('./characterCards', () => ({ importCharacter: vi.fn() }))
vi.mock('./pngChunk', () => ({ PngChunk: { readGenerator: vi.fn() } }))
vi.mock('./process/coldstorage.svelte', () => ({ getColdStorageItem: vi.fn() }))

import { getCharacterSidebarImage } from './characters'
import { DBState } from './stores.svelte'

const originalCreateElement = document.createElement.bind(document)
let mockCanvas: any

function installImageAndCanvasMocks(blob: Blob | null = new Blob([new Uint8Array([9, 8, 7])], { type: 'image/webp' })) {
    vi.stubGlobal(
        'Image',
        class {
            width = 320
            height = 180
            onload: (() => void) | null = null
            onerror: (() => void) | null = null

            set src(_value: string) {
                queueMicrotask(() => this.onload?.())
            }
        },
    )

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName !== 'canvas') {
            return originalCreateElement(tagName)
        }

        mockCanvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => ({
                drawImage: vi.fn(),
            })),
            toBlob: vi.fn((callback: (blob: Blob | null) => void) => {
                callback(blob)
            }),
        }
        return mockCanvas
    })
}

beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    mocks.dbState.db = {
        hideAllImages: false,
        characters: [],
    }
    mocks.getFileSrc.mockImplementation(async (loc: string) => `resolved:${loc}`)
    mocks.hasher.mockResolvedValue('thumbhash')
    mocks.saveImage.mockImplementation(async (_data: Uint8Array, customId: string, fileName: string) => {
        const ext = fileName.split('.').pop() ?? 'png'
        return `assets/${customId}.${ext}`
    })
    mockCanvas = undefined
})

describe('getCharacterSidebarImage', () => {
    test('uses an existing thumbnail before the original icon', async () => {
        ;(DBState.db as any).characters = [{
            chaId: 'char-1',
            image: 'assets/full.png',
            imageThumbnail: 'assets/thumbnail/existing.webp',
            imageThumbnailVersion: 2,
        }]

        await expect(getCharacterSidebarImage(0)).resolves.toBe('resolved:assets/thumbnail/existing.webp')

        expect(mocks.getFileSrc).toHaveBeenCalledWith('assets/thumbnail/existing.webp')
        expect(mocks.readImage).not.toHaveBeenCalled()
        expect(mocks.saveImage).not.toHaveBeenCalled()
    })

    test('regenerates stale thumbnails from an older thumbnail version', async () => {
        installImageAndCanvasMocks()
        mocks.readImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
        ;(DBState.db as any).characters = [{
            chaId: 'char-1',
            image: 'assets/full.png',
            imageThumbnail: 'assets/thumbnail/old.webp',
        }]

        await expect(getCharacterSidebarImage(0)).resolves.toBe('resolved:assets/thumbnail/thumbhash.webp')

        expect(mocks.getFileSrc).not.toHaveBeenCalledWith('assets/thumbnail/old.webp')
        expect(mocks.readImage).toHaveBeenCalledWith('assets/full.png')
        expect(DBState.db.characters[0].imageThumbnail).toBe('assets/thumbnail/thumbhash.webp')
        expect(DBState.db.characters[0].imageThumbnailVersion).toBe(2)
    })

    test('creates a low-res thumbnail under assets/thumbnail when missing', async () => {
        installImageAndCanvasMocks()
        mocks.readImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
        ;(DBState.db as any).characters = [{
            chaId: 'char-1',
            image: 'assets/full.png',
        }]

        await expect(getCharacterSidebarImage(0)).resolves.toBe('resolved:assets/thumbnail/thumbhash.webp')

        expect(mocks.readImage).toHaveBeenCalledWith('assets/full.png')
        expect(mockCanvas.width).toBe(192)
        expect(mockCanvas.height).toBe(108)
        expect(mockCanvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.8)
        expect(mocks.saveImage).toHaveBeenCalledWith(expect.any(Uint8Array), 'thumbnail/thumbhash', 'thumbnail.webp')
        expect(DBState.db.characters[0].imageThumbnail).toBe('assets/thumbnail/thumbhash.webp')
        expect(DBState.db.characters[0].imageThumbnailVersion).toBe(2)
    })

    test('does not create thumbnails while all images are hidden', async () => {
        ;(DBState.db as any).hideAllImages = true
        ;(DBState.db as any).characters = [{
            chaId: 'char-1',
            image: 'assets/full.png',
        }]

        await expect(getCharacterSidebarImage(0)).resolves.toBe('/none.webp')

        expect(mocks.readImage).not.toHaveBeenCalled()
        expect(mocks.saveImage).not.toHaveBeenCalled()
        expect(DBState.db.characters[0].imageThumbnail).toBeUndefined()
    })

    test('falls back to the original icon if thumbnail generation fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.readImage.mockRejectedValue(new Error('missing image'))
        ;(DBState.db as any).characters = [{
            chaId: 'char-1',
            image: 'assets/full.png',
        }]

        await expect(getCharacterSidebarImage(0)).resolves.toBe('resolved:assets/full.png')

        expect(mocks.saveImage).not.toHaveBeenCalled()
        expect(DBState.db.characters[0].imageThumbnail).toBeUndefined()
    })
})
