import { describe, expect, it, vi } from 'vitest';
import { PipKeepAliveController, type PipKeepAliveError } from './pipKeepAlive';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createHarness(readyState = 1) {
    const listeners = new Map<string, Set<EventListener>>();
    const play = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const requestPictureInPicture = vi.fn<() => Promise<PictureInPictureWindow>>(() => Promise.resolve({} as PictureInPictureWindow));
    const pause = vi.fn();
    const load = vi.fn();
    const remove = vi.fn();
    const setAttribute = vi.fn();
    const removeAttribute = vi.fn();

    const video = {
        src: '',
        preload: '',
        loop: false,
        playsInline: false,
        disablePictureInPicture: true,
        width: 0,
        height: 0,
        style: {},
        readyState,
        paused: true,
        currentTime: 12,
        play,
        pause,
        load,
        remove,
        setAttribute,
        removeAttribute,
        requestPictureInPicture,
        addEventListener: vi.fn((type: string, listener: EventListener) => {
            const set = listeners.get(type) ?? new Set<EventListener>();
            set.add(listener);
            listeners.set(type, set);
        }),
        removeEventListener: vi.fn((type: string, listener: EventListener) => {
            listeners.get(type)?.delete(listener);
        })
    } as unknown as HTMLVideoElement & { requestPictureInPicture: () => Promise<PictureInPictureWindow> };

    const dispatch = (type: string) => {
        for (const listener of listeners.get(type) ?? []) listener(new Event(type));
    };

    const body = { appendChild: vi.fn() };
    const doc = {
        body,
        pictureInPictureEnabled: true,
        pictureInPictureElement: null as Element | null,
        createElement: vi.fn(() => video),
        exitPictureInPicture: vi.fn(async () => {
            doc.pictureInPictureElement = null;
            dispatch('leavepictureinpicture');
        })
    } as unknown as Document & {
        pictureInPictureEnabled: boolean;
        pictureInPictureElement: Element | null;
        exitPictureInPicture: () => Promise<void>;
    };

    requestPictureInPicture.mockImplementation(async () => {
        doc.pictureInPictureElement = video;
        return {} as PictureInPictureWindow;
    });

    const sound = {
        loop: false,
        volume: 1,
        currentTime: 12,
        play: vi.fn(() => Promise.resolve()),
        pause: vi.fn()
    } as unknown as HTMLAudioElement;
    const errors: PipKeepAliveError[] = [];
    const notReady = vi.fn();
    const controller = new PipKeepAliveController({
        videoSrc: '/keepAlive.mp4',
        soundSrc: '/send.mp3',
        createVideo: () => video,
        createAudio: () => sound,
        getDocument: () => doc,
        onNotReady: notReady,
        onError: (error) => errors.push(error)
    });

    return { controller, video, sound, doc, play, pause, load, remove, requestPictureInPicture, dispatch, errors, notReady };
}

describe('PipKeepAliveController', () => {
    it('starts playback and PiP in the same user gesture stack', async () => {
        const h = createHarness();
        const playDeferred = deferred<void>();
        const pipDeferred = deferred<PictureInPictureWindow>();
        const calls: string[] = [];
        h.play.mockImplementation(() => {
            calls.push('play');
            return playDeferred.promise;
        });
        h.requestPictureInPicture.mockImplementation(() => {
            calls.push('pip');
            h.doc.pictureInPictureElement = h.video;
            return pipDeferred.promise;
        });

        h.controller.syncMode('pip');
        const result = h.controller.startFromUserGesture();

        expect(calls).toEqual(['play', 'pip']);
        playDeferred.resolve();
        pipDeferred.resolve({} as PictureInPictureWindow);
        await expect(result).resolves.toBe('started');
    });

    it('asks for another input while metadata is loading and retries', async () => {
        const h = createHarness(0);
        h.controller.syncMode('pip');

        await expect(h.controller.startFromUserGesture()).resolves.toBe('not-ready');
        expect(h.notReady).toHaveBeenCalledOnce();
        expect(h.play).not.toHaveBeenCalled();
        expect(h.requestPictureInPicture).not.toHaveBeenCalled();

        Object.defineProperty(h.video, 'readyState', { value: 1 });
        await expect(h.controller.startFromUserGesture()).resolves.toBe('started');
    });

    it('reports unsupported PiP without starting playback', async () => {
        const h = createHarness();
        h.doc.pictureInPictureEnabled = false;
        h.controller.syncMode('pip');

        await expect(h.controller.startFromUserGesture()).resolves.toBe('failed');
        expect(h.errors).toEqual(['unsupported']);
        expect(h.play).not.toHaveBeenCalled();
        expect(h.pause).toHaveBeenCalled();
        expect(h.video.currentTime).toBe(0);
    });

    it('cleans up when playback is rejected', async () => {
        const h = createHarness();
        const pipDeferred = deferred<PictureInPictureWindow>();
        h.play.mockRejectedValue(new Error('autoplay denied'));
        h.requestPictureInPicture.mockImplementation(() => {
            h.doc.pictureInPictureElement = h.video;
            return pipDeferred.promise;
        });
        h.controller.syncMode('pip');

        const result = h.controller.startFromUserGesture();
        expect(h.requestPictureInPicture).toHaveBeenCalledOnce();
        pipDeferred.resolve({} as PictureInPictureWindow);
        await expect(result).resolves.toBe('failed');
        expect(h.doc.exitPictureInPicture).toHaveBeenCalledOnce();
        expect(h.errors).toEqual(['playback']);
        expect(h.pause).toHaveBeenCalled();
    });

    it('cleans up when the PiP request is rejected', async () => {
        const h = createHarness();
        h.requestPictureInPicture.mockRejectedValue(new Error('permission denied'));
        h.controller.syncMode('pip');

        await expect(h.controller.startFromUserGesture()).resolves.toBe('failed');
        expect(h.errors).toEqual(['request']);
        expect(h.pause).toHaveBeenCalled();
        expect(h.video.currentTime).toBe(0);
    });

    it('does not reopen after a user closes PiP until the mode is reselected', async () => {
        const h = createHarness();
        h.controller.syncMode('pip');
        await h.controller.startFromUserGesture();

        h.doc.pictureInPictureElement = null;
        h.dispatch('leavepictureinpicture');
        await expect(h.controller.startFromUserGesture()).resolves.toBe('ignored');
        expect(h.requestPictureInPicture).toHaveBeenCalledTimes(1);

        h.controller.syncMode('off');
        h.controller.syncMode('pip');
        await expect(h.controller.startFromUserGesture()).resolves.toBe('started');
        expect(h.requestPictureInPicture).toHaveBeenCalledTimes(2);
    });

    it('stops each medium while switching from PiP to sound to off', async () => {
        const h = createHarness();
        h.controller.syncMode('pip');
        await h.controller.startFromUserGesture();

        h.controller.syncMode('sound');
        expect(h.doc.exitPictureInPicture).toHaveBeenCalledOnce();
        expect(h.pause).toHaveBeenCalled();
        await expect(h.controller.startFromUserGesture()).resolves.toBe('started');
        expect(h.sound.loop).toBe(true);
        expect(h.sound.volume).toBe(0.000001);

        h.controller.syncMode('off');
        expect(h.sound.pause).toHaveBeenCalledOnce();
        expect(h.sound.currentTime).toBe(0);
    });

    it('releases listeners and media when destroyed', () => {
        const h = createHarness();
        h.controller.prepare();
        h.controller.destroy();

        expect(h.video.removeEventListener).toHaveBeenCalledWith('leavepictureinpicture', expect.any(Function));
        expect(h.video.removeAttribute).toHaveBeenCalledWith('src');
        expect(h.remove).toHaveBeenCalledOnce();
    });
});
