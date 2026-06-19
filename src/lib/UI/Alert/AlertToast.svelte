<script lang="ts">
    import { CheckIcon } from '@lucide/svelte';
    import { alertStore, DBState } from 'src/ts/stores.svelte';
    import type { AlertSeverity } from 'src/ts/alertModel';
    import AlertSeverityIcon from './AlertSeverityIcon.svelte';

    const TOAST_VISIBLE_MS = 2000;
    const TOAST_EXIT_MS = 180;

    interface Props {
        message: string;
        severity: AlertSeverity;
        refreshKey: unknown;
    }

    let { message, severity, refreshKey }: Props = $props();
    let entered = $state(false);
    let dismissing = $state(false);
    let enterFrame: ReturnType<typeof requestAnimationFrame> | undefined;
    let visibleTimer: ReturnType<typeof setTimeout> | undefined;
    let dismissTimer: ReturnType<typeof setTimeout> | undefined;

    const severityConfig: Record<AlertSeverity, {
        iconColor: string;
        chipBg: string;
        accent: string;
        glow: string;
    }> = {
        success: {
            iconColor: 'rgb(52 211 153)',
            chipBg: 'rgb(52 211 153 / 0.16)',
            accent: 'rgb(52 211 153 / 0.55)',
            glow: 'rgb(52 211 153 / 0.22)',
        },
        info: {
            iconColor: 'rgb(96 165 250)',
            chipBg: 'rgb(96 165 250 / 0.16)',
            accent: 'rgb(96 165 250 / 0.55)',
            glow: 'rgb(96 165 250 / 0.22)',
        },
        warning: {
            iconColor: 'rgb(251 191 36)',
            chipBg: 'rgb(251 191 36 / 0.16)',
            accent: 'rgb(251 191 36 / 0.55)',
            glow: 'rgb(251 191 36 / 0.22)',
        },
        error: {
            iconColor: 'rgb(248 113 113)',
            chipBg: 'rgb(248 113 113 / 0.16)',
            accent: 'rgb(248 113 113 / 0.55)',
            glow: 'rgb(248 113 113 / 0.22)',
        },
        neutral: {
            iconColor: 'rgb(156 163 175)',
            chipBg: 'rgb(156 163 175 / 0.16)',
            accent: 'rgb(156 163 175 / 0.45)',
            glow: 'rgb(0 0 0 / 0.2)',
        },
    };

    const config = $derived(severityConfig[severity]);
    const toastFontSize = $derived(`${0.875 * ((DBState.db.zoomsize ?? 100) / 100)}rem`);
    const toastPosition = $derived(DBState.db.toastPosition === 'topRight' ? 'topRight' : 'topCenter');
    const toastPositionClass = $derived(toastPosition === 'topRight' ? 'position-top-right' : 'position-top-center');

    function clearToastTimers() {
        if (enterFrame !== undefined) {
            cancelAnimationFrame(enterFrame);
            enterFrame = undefined;
        }

        if (visibleTimer) {
            clearTimeout(visibleTimer);
            visibleTimer = undefined;
        }

        if (dismissTimer) {
            clearTimeout(dismissTimer);
            dismissTimer = undefined;
        }
    }

    function closeToast() {
        clearToastTimers();
        alertStore.set({
            type: 'none',
            msg: '',
        });
    }

    function startToastCountdown() {
        clearToastTimers();
        entered = false;
        dismissing = false;

        enterFrame = requestAnimationFrame(() => {
            entered = true;
            enterFrame = undefined;
        });

        visibleTimer = setTimeout(() => {
            dismissing = true;
            dismissTimer = setTimeout(closeToast, TOAST_EXIT_MS);
        }, TOAST_VISIBLE_MS);
    }

    $effect(() => {
        message;
        refreshKey;

        startToastCountdown();

        return clearToastTimers;
    });
</script>

<div
    class:entered
    class:dismissing
    class="toast-shell {toastPositionClass} fixed top-4 z-50 flex items-center gap-3 overflow-y-auto break-any"
    style:--toast-icon-color={config.iconColor}
    style:--toast-chip-bg={config.chipBg}
    style:--toast-accent={config.accent}
    style:--toast-glow={config.glow}
    style:--toast-font-size={toastFontSize}
    role="status"
    aria-live="polite"
>
    <span class="toast-chip" aria-hidden="true">
        {#if severity === 'success'}
            <CheckIcon size={16} strokeWidth={2.6} />
        {:else}
            <AlertSeverityIcon severity={severity} size={16} />
        {/if}
    </span>
    <span class="toast-msg">{message}</span>
</div>

<style>
    .break-any {
        word-break: normal;
        overflow-wrap: anywhere;
    }

    .position-top-center {
        left: 50%;
        --toast-enter-transform: translate(-50%, -130%) scale(0.96);
        --toast-visible-transform: translate(-50%, 0) scale(1);
        transform-origin: top center;
    }

    .position-top-right {
        right: 1rem;
        --toast-enter-transform: translate(0, -130%) scale(0.96);
        --toast-visible-transform: translate(0, 0) scale(1);
        transform-origin: top right;
    }

    .toast-shell {
        box-sizing: border-box;
        width: fit-content;
        max-width: min(calc(100vw - 2rem), 38em);
        max-height: min(18em, 70vh);
        padding: 0.6em 1em 0.6em 0.6em;
        border-radius: 0.375rem;
        border: 1px solid color-mix(in srgb, var(--toast-accent) 70%, var(--risu-theme-darkborderc, rgb(75 75 75)));
        background: color-mix(in srgb, var(--risu-theme-darkbg, rgb(17 17 17)) 88%, transparent);
        color: var(--risu-theme-textcolor, #e5e5e5);
        font-size: var(--toast-font-size, 0.875rem);
        line-height: 1.35;
        backdrop-filter: blur(10px);
        opacity: 0;
        transform: var(--toast-enter-transform);
        box-shadow:
            0 10px 30px -8px rgb(0 0 0 / 0.55),
            0 0 0 1px color-mix(in srgb, var(--toast-accent) 25%, transparent),
            0 0 22px -6px var(--toast-glow);
        transition:
            opacity 180ms cubic-bezier(0.16, 1, 0.3, 1),
            transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
        will-change: transform, opacity;
    }

    .toast-shell.entered {
        opacity: 1;
        transform: var(--toast-visible-transform);
    }

    .toast-shell.dismissing {
        pointer-events: none;
        opacity: 0;
        transform: var(--toast-enter-transform);
        transition-timing-function: ease-in;
    }

    .toast-chip {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 1.9em;
        height: 1.9em;
        border-radius: 9999px;
        background: var(--toast-chip-bg);
        color: var(--toast-icon-color);
    }

    .toast-chip :global(svg) {
        display: block;
        width: 1.08em;
        height: 1.08em;
    }

    .toast-msg {
        flex: 1 1 auto;
        min-width: 0;
        text-align: left;
        white-space: pre-wrap;
    }
</style>
