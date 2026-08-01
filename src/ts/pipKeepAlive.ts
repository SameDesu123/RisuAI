export type KeepAliveMode = 'off' | 'pip' | 'sound';

export type PipKeepAliveError = 'unsupported' | 'playback' | 'request';

export type KeepAliveStartResult = 'failed' | 'ignored' | 'not-ready' | 'started';

interface PipKeepAliveControllerOptions {
    videoSrc: string;
    soundSrc: string;
    createVideo?: () => HTMLVideoElement;
    createAudio?: () => HTMLAudioElement;
    getDocument?: () => Document;
    onNotReady: () => void;
    onError: (error: PipKeepAliveError) => void;
}

type StartFailure = {
    stage: 'playback' | 'request';
    cause: unknown;
};

export class PipKeepAliveController {
    private mode: KeepAliveMode = 'off';
    private video: HTMLVideoElement | null = null;
    private sound: HTMLAudioElement | null = null;
    private active = false;
    private starting = false;
    private dismissed = false;
    private destroyed = false;
    private ignoreNextLeave = false;
    private attempt = 0;

    constructor(private readonly options: PipKeepAliveControllerOptions) {}

    prepare(): void {
        if (this.destroyed || this.video) return;

        const doc = this.options.getDocument?.() ?? document;
        const video = this.options.createVideo?.() ?? doc.createElement('video');
        video.src = this.options.videoSrc;
        video.preload = 'metadata';
        video.loop = true;
        video.playsInline = true;
        video.disablePictureInPicture = false;
        video.width = 320;
        video.height = 180;
        video.setAttribute('aria-hidden', 'true');
        video.style.position = 'fixed';
        video.style.left = '-10000px';
        video.style.width = '1px';
        video.style.height = '1px';
        video.style.pointerEvents = 'none';
        video.addEventListener('leavepictureinpicture', this.handleLeavePictureInPicture);
        doc.body.appendChild(video);
        video.load();
        this.video = video;
    }

    syncMode(mode: KeepAliveMode): void {
        if (this.destroyed || mode === this.mode) {
            if (mode === 'pip') this.prepare();
            return;
        }

        this.mode = mode;
        this.dismissed = false;
        this.stop();

        if (mode === 'pip') this.prepare();
    }

    startFromUserGesture(): Promise<KeepAliveStartResult> {
        if (this.destroyed) return Promise.resolve('ignored');
        if (this.mode === 'sound') return this.startSound();
        if (this.mode !== 'pip' || this.active || this.starting || this.dismissed) {
            return Promise.resolve('ignored');
        }

        this.prepare();
        const video = this.video;
        const doc = this.options.getDocument?.() ?? document;

        if (!video || typeof video.requestPictureInPicture !== 'function' || doc.pictureInPictureEnabled !== true) {
            this.options.onError('unsupported');
            this.resetVideo();
            return Promise.resolve('failed');
        }

        if (video.readyState < 1) {
            video.load();
            this.options.onNotReady();
            return Promise.resolve('not-ready');
        }

        const attempt = ++this.attempt;
        this.starting = true;

        let playPromise: Promise<void>;
        try {
            playPromise = Promise.resolve(video.play()).catch((cause) => {
                throw { stage: 'playback', cause } satisfies StartFailure;
            });
        } catch (cause) {
            playPromise = Promise.reject({ stage: 'playback', cause } satisfies StartFailure);
        }

        let pipPromise: Promise<PictureInPictureWindow>;
        try {
            // Both calls are made before yielding so they share the trusted user gesture.
            pipPromise = video.requestPictureInPicture().catch((cause) => {
                throw { stage: 'request', cause } satisfies StartFailure;
            });
        } catch (cause) {
            pipPromise = Promise.reject({ stage: 'request', cause } satisfies StartFailure);
        }

        return Promise.allSettled([playPromise, pipPromise]).then((results) => {
            const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
            if (failure) return this.finishFailedStart(attempt, failure.reason as StartFailure);

            if (this.destroyed || this.mode !== 'pip' || attempt !== this.attempt || this.dismissed) {
                this.stop();
                return 'ignored';
            }
            this.starting = false;
            this.active = true;
            return 'started';
        });
    }

    stop(): void {
        this.attempt += 1;
        this.starting = false;
        this.active = false;
        this.stopSound();
        this.exitPictureInPicture();
        this.resetVideo();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.stop();

        if (this.video) {
            this.video.removeEventListener('leavepictureinpicture', this.handleLeavePictureInPicture);
            this.video.removeAttribute('src');
            this.video.load();
            this.video.remove();
            this.video = null;
        }
    }

    private startSound(): Promise<KeepAliveStartResult> {
        if (this.sound) return Promise.resolve('ignored');

        const sound = this.options.createAudio?.() ?? new Audio(this.options.soundSrc);
        sound.loop = true;
        sound.volume = 0.000001;
        this.sound = sound;

        let playPromise: Promise<void>;
        try {
            playPromise = Promise.resolve(sound.play());
        } catch {
            this.stopSound();
            this.options.onError('playback');
            return Promise.resolve('failed');
        }

        return playPromise.then<KeepAliveStartResult>(() => 'started').catch(() => {
            this.stopSound();
            this.options.onError('playback');
            return 'failed';
        });
    }

    private finishFailedStart(attempt: number, failure: StartFailure): Promise<KeepAliveStartResult> {
        if (attempt !== this.attempt) return Promise.resolve('ignored');

        this.starting = false;
        this.active = false;
        this.exitPictureInPicture();
        this.resetVideo();
        this.options.onError(failure.stage);
        return Promise.resolve('failed');
    }

    private exitPictureInPicture(): void {
        const video = this.video;
        const doc = this.options.getDocument?.() ?? document;
        if (!video || doc.pictureInPictureElement !== video || typeof doc.exitPictureInPicture !== 'function') return;

        this.ignoreNextLeave = true;
        void doc.exitPictureInPicture().catch(() => {
            this.ignoreNextLeave = false;
        });
    }

    private resetVideo(): void {
        if (!this.video) return;
        this.video.pause();
        try {
            this.video.currentTime = 0;
        } catch {
            // Some browsers reject seeking before media metadata is available.
        }
    }

    private stopSound(): void {
        if (!this.sound) return;
        this.sound.pause();
        this.sound.currentTime = 0;
        this.sound = null;
    }

    private handleLeavePictureInPicture = (): void => {
        if (this.ignoreNextLeave) {
            this.ignoreNextLeave = false;
            return;
        }

        this.active = false;
        this.starting = false;
        if (this.mode === 'pip') this.dismissed = true;
        this.resetVideo();
    };
}
