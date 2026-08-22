/**
 * Window Chrome Controller
 *
 * Optional custom desktop title bar support for Tauri desktop builds.
 *
 * - macOS keeps native traffic lights and switches to `overlay` title bar style.
 * - Windows/Linux hide native decorations and provide in-app window controls.
 * - The preference is stored per-device in localStorage (never in the main DB,
 *   never account-synced) because window decoration is device/OS specific.
 *
 * Transitions are serialized so rapid toggles cannot interleave, and every
 * failure path restores native window controls before giving up.
 */
import { isTauri } from '../platform';
import * as tauriOs from '@tauri-apps/plugin-os';

export type DesktopTitleBarPlatform = 'macos' | 'windows' | 'linux';

export const TITLE_BAR_STORAGE_PREFIX = 'risu.modern-desktop-titlebar';
export const TITLE_BAR_STORAGE_VERSION = 'v1';

/** Only the exact string "true" activates the feature. */
export function parseTitleBarStoredValue(raw: string | null | undefined): boolean {
    return raw === 'true';
}

export function getTitleBarStorageKey(platform: DesktopTitleBarPlatform): string {
    return `${TITLE_BAR_STORAGE_PREFIX}.${platform}.${TITLE_BAR_STORAGE_VERSION}`;
}

/**
 * Pure platform -> native chrome mapping.
 *
 * - macOS keeps native traffic lights: only the title bar style changes
 *   (`overlay` while hidden, `visible` restored).
 * - Windows/Linux toggle native window decorations off/on.
 */
export type NativeChromeAction =
    | { kind: 'title-bar-style'; style: 'visible' | 'overlay' }
    | { kind: 'decorations'; value: boolean };

export function getNativeChromeAction(
    platform: DesktopTitleBarPlatform,
    hide: boolean
): NativeChromeAction {
    if (platform === 'macos') {
        return { kind: 'title-bar-style', style: hide ? 'overlay' : 'visible' };
    }
    return { kind: 'decorations', value: !hide };
}

/** Returns the desktop platform when running inside Tauri on a supported OS. */
export function getTauriDesktopPlatform(): DesktopTitleBarPlatform | null {
    if (!isTauri) {
        return null;
    }
    try {
        const type = tauriOs.type();
        if (type === 'macos' || type === 'windows' || type === 'linux') {
            return type;
        }
    } catch (error) {
        console.warn('Failed to detect Tauri platform for window chrome:', error);
    }
    return null;
}

export interface WindowChromeDeps {
    /** null means the feature is unsupported (web, node, mobile Tauri). */
    platform: DesktopTitleBarPlatform | null;
    /** macOS: setTitleBarStyle('overlay') / Windows+Linux: setDecorations(false) */
    hideNativeChrome(): Promise<void>;
    /** macOS: setTitleBarStyle('visible') / Windows+Linux: setDecorations(true) */
    restoreNativeChrome(): Promise<void>;
    readStoredPreference(): string | null;
    writeStoredPreference(value: string): void;
    /** Waits until the custom title bar had a chance to render (Svelte tick). */
    afterDomUpdate?(): Promise<void>;
}

export interface WindowChromeController {
    isEnabled(): boolean;
    isTransitioning(): boolean;
    /**
     * Startup path: mirrors the per-device preference into reactive state only.
     * Native chrome is left untouched; hiding happens once the bar rendered
     * (see `ensureApplied`).
     */
    init(): boolean;
    /** Hides native chrome after the custom bar became visible. Idempotent. */
    ensureApplied(): Promise<boolean>;
    /**
     * Activation order: enable UI -> wait -> hide native chrome.
     * Deactivation order: restore native chrome -> disable UI.
     * Returns the resulting state.
     */
    setEnabled(next: boolean): Promise<boolean>;
}

export function createWindowChromeController(deps: WindowChromeDeps): WindowChromeController {
    let enabled = false;
    let applied = false;
    let initialized = false;
    let transitioning = false;
    let queue: Promise<unknown> = Promise.resolve();

    const serialize = <T>(task: () => Promise<T>): Promise<T> => {
        const run = queue.then(task);
        queue = run.catch(() => undefined);
        return run;
    };

    const waitDomUpdate = async () => {
        if (deps.afterDomUpdate) {
            await deps.afterDomUpdate();
            return;
        }
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    };

    const applyHidden = async () => {
        await deps.hideNativeChrome();
        applied = true;
    };

    const applyRestored = async () => {
        await deps.restoreNativeChrome();
        applied = false;
    };

    /**
     * Hides native chrome; on failure keeps native decorations and rolls the
     * preference back to "false". Must only run inside the serialized queue.
     */
    const tryHideNativeSafely = async (): Promise<boolean> => {
        try {
            await applyHidden();
            return true;
        } catch (error) {
            console.warn('Failed to hide native window chrome:', error);
            try {
                await applyRestored();
            } catch (restoreError) {
                console.error('Failed to restore native title bar:', restoreError);
            }
            enabled = false;
            deps.writeStoredPreference('false');
            return false;
        }
    };

    const controller: WindowChromeController = {
        isEnabled: () => enabled,
        isTransitioning: () => transitioning,

        init() {
            if (!initialized) {
                initialized = true;
                enabled = deps.platform !== null && parseTitleBarStoredValue(deps.readStoredPreference());
            }
            return enabled;
        },

        async ensureApplied() {
            return serialize(async () => {
                if (!enabled || applied || !initialized) {
                    return enabled;
                }
                await tryHideNativeSafely();
                return enabled;
            });
        },

        async setEnabled(next: boolean) {
            return serialize(async () => {
                if (!initialized) {
                    controller.init();
                }
                if (deps.platform === null) {
                    return false;
                }
                if (next === enabled) {
                    if (next && !applied) {
                        await waitDomUpdate();
                        await tryHideNativeSafely();
                    }
                    return enabled;
                }
                transitioning = true;
                try {
                    if (next) {
                        // 1. Activate custom bar first so it renders...
                        enabled = true;
                        deps.writeStoredPreference('true');
                        // 2. ...wait for it to render...
                        await waitDomUpdate();
                        // 3./4. ...then hide native chrome (fail safe inside).
                        await tryHideNativeSafely();
                    } else {
                        // 1. Restore native chrome first...
                        try {
                            await applyRestored();
                            // 2. ...then hide the custom bar.
                            enabled = false;
                            deps.writeStoredPreference('false');
                        } catch (error) {
                            console.warn('Failed to restore native title bar:', error);
                            // Keep the custom bar usable; do not persist the change.
                        }
                    }
                } finally {
                    transitioning = false;
                }
                return enabled;
            });
        },
    };

    return controller;
}

/**
 * Reactive mirror of the controller state for Svelte components/settings.
 */
export const desktopTitleBarState = $state({
    enabled: false,
    available: getTauriDesktopPlatform() !== null,
});

function createProductionController(): WindowChromeController | null {
    const platform = getTauriDesktopPlatform();
    if (platform === null) {
        return null;
    }
    const storageKey = getTitleBarStorageKey(platform);
    let appWindowPromise: Promise<{
        setTitleBarStyle(style: 'visible' | 'transparent' | 'overlay'): Promise<void>;
        setDecorations(decorations: boolean): Promise<void>;
    }> | null = null;

    const getAppWindow = () => {
        if (!appWindowPromise) {
            appWindowPromise = import('@tauri-apps/api/webviewWindow').then((m) =>
                m.getCurrentWebviewWindow()
            );
        }
        return appWindowPromise;
    };

    const applyChromeAction = async (action: NativeChromeAction) => {
        const appWindow = await getAppWindow();
        if (action.kind === 'title-bar-style') {
            await appWindow.setTitleBarStyle(action.style);
        } else {
            await appWindow.setDecorations(action.value);
        }
    };

    return createWindowChromeController({
        platform,
        hideNativeChrome() {
            return applyChromeAction(getNativeChromeAction(platform, true));
        },
        restoreNativeChrome() {
            return applyChromeAction(getNativeChromeAction(platform, false));
        },
        readStoredPreference() {
            try {
                return localStorage.getItem(storageKey);
            } catch {
                return null;
            }
        },
        writeStoredPreference(value) {
            try {
                localStorage.setItem(storageKey, value);
            } catch (error) {
                console.warn('Failed to persist title bar preference:', error);
            }
        },
        afterDomUpdate() {
            return import('svelte').then((svelte) => svelte.tick());
        },
    });
}

export const windowChrome = createProductionController();

/** Startup hook: call as early as possible once the app loads. */
export function initDesktopTitleBar(): boolean {
    if (!windowChrome) {
        return false;
    }
    const enabled = windowChrome.init();
    desktopTitleBarState.enabled = enabled;
    return enabled;
}

/**
 * Called by DesktopTitleBar.svelte after the bar actually mounted, so native
 * buttons are only removed once their replacements are on screen.
 */
export async function ensureDesktopTitleBarApplied(): Promise<boolean> {
    if (!windowChrome) {
        return false;
    }
    const enabled = await windowChrome.ensureApplied();
    desktopTitleBarState.enabled = enabled;
    return enabled;
}

/** Settings entry point. Rolls back state/storage on failure. */
export async function setDesktopTitleBarEnabled(next: boolean): Promise<boolean> {
    if (!windowChrome) {
        return false;
    }
    const enabled = await windowChrome.setEnabled(next);
    desktopTitleBarState.enabled = enabled;
    return enabled;
}
