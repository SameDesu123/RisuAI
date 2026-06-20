<script lang="ts">
    import { ChevronDownIcon, ChevronUpIcon } from '@lucide/svelte';
    import { pinnedStatusStore, togglePinnedStatusCollapsed } from 'src/ts/pinnedStatus';
    import AlertSeverityIcon from './AlertSeverityIcon.svelte';
    import { alertSeverityStyles } from './alertSeverityStyles';
</script>

{#if $pinnedStatusStore.length > 0}
    <div class="pinned-status-stack fixed right-4 top-[4.25rem] z-40 flex flex-col gap-2 pointer-events-none">
        {#each $pinnedStatusStore as item (item.key)}
            {@const config = alertSeverityStyles[item.severity]}
            <section
                class:collapsed={item.collapsed}
                class="pinned-status-card pointer-events-auto"
                style:--pinned-icon-color={config.iconColor}
                style:--pinned-chip-bg={config.chipBg}
                style:--pinned-accent={config.accent}
                style:--pinned-glow={config.glow}
                role="status"
                aria-live="polite"
            >
                <div class="pinned-status-row">
                    <span class="pinned-status-chip" aria-hidden="true">
                        <AlertSeverityIcon severity={item.severity} size={16} />
                    </span>
                    <div class="pinned-status-copy">
                        <div class="pinned-status-heading">
                            <span class="pinned-status-title">{item.title}</span>
                            {#if item.value}
                                <span class="pinned-status-value">{item.value}</span>
                            {/if}
                        </div>
                        {#if !item.collapsed}
                            {#if item.message}
                                <p class="pinned-status-message">{item.message}</p>
                            {/if}
                            {#if item.detail}
                                <p class="pinned-status-detail">{item.detail}</p>
                            {/if}
                        {/if}
                    </div>
                    <button
                        type="button"
                        class="pinned-status-toggle"
                        aria-label={item.collapsed ? 'Expand pinned status' : 'Collapse pinned status'}
                        aria-expanded={!item.collapsed}
                        onclick={() => togglePinnedStatusCollapsed(item.key)}
                    >
                        {#if item.collapsed}
                            <ChevronDownIcon size={16} />
                        {:else}
                            <ChevronUpIcon size={16} />
                        {/if}
                    </button>
                </div>
            </section>
        {/each}
    </div>
{/if}

<style>
    .pinned-status-stack {
        width: min(calc(100vw - 2rem), 24rem);
    }

    .pinned-status-card {
        box-sizing: border-box;
        width: 100%;
        padding: 0.65rem;
        border-radius: 0.375rem;
        border: 1px solid color-mix(in srgb, var(--pinned-accent) 70%, var(--risu-theme-darkborderc, rgb(75 75 75)));
        background: color-mix(in srgb, var(--risu-theme-darkbg, rgb(17 17 17)) 90%, transparent);
        color: var(--risu-theme-textcolor, #e5e5e5);
        backdrop-filter: blur(10px);
        box-shadow:
            0 10px 30px -8px rgb(0 0 0 / 0.45),
            0 0 0 1px color-mix(in srgb, var(--pinned-accent) 20%, transparent),
            0 0 20px -8px var(--pinned-glow);
    }

    .pinned-status-card.collapsed {
        padding-block: 0.55rem;
    }

    .pinned-status-row {
        display: flex;
        align-items: flex-start;
        gap: 0.65rem;
        min-width: 0;
    }

    .pinned-status-chip {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 1.9rem;
        height: 1.9rem;
        border-radius: 9999px;
        background: var(--pinned-chip-bg);
        color: var(--pinned-icon-color);
    }

    .pinned-status-chip :global(svg) {
        display: block;
        width: 1rem;
        height: 1rem;
    }

    .pinned-status-copy {
        flex: 1 1 auto;
        min-width: 0;
    }

    .pinned-status-heading {
        display: flex;
        align-items: baseline;
        gap: 0.6rem;
        min-width: 0;
    }

    .pinned-status-title {
        min-width: 0;
        overflow-wrap: anywhere;
        font-weight: 700;
        line-height: 1.35;
    }

    .pinned-status-value {
        flex: none;
        color: var(--pinned-icon-color);
        font-size: 0.85rem;
        font-weight: 700;
        line-height: 1.35;
    }

    .pinned-status-message,
    .pinned-status-detail {
        margin: 0.25rem 0 0;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
        font-size: 0.85rem;
        line-height: 1.35;
    }

    .pinned-status-message {
        color: color-mix(in srgb, var(--risu-theme-textcolor, #e5e5e5) 88%, transparent);
    }

    .pinned-status-detail {
        color: var(--risu-theme-textcolor2, #a3a3a3);
    }

    .pinned-status-toggle {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 1.8rem;
        height: 1.8rem;
        border-radius: 0.375rem;
        color: var(--risu-theme-textcolor2, #a3a3a3);
        transition:
            background-color 120ms ease,
            color 120ms ease;
    }

    .pinned-status-toggle:hover {
        background: color-mix(in srgb, var(--pinned-accent) 22%, transparent);
        color: var(--risu-theme-textcolor, #e5e5e5);
    }

    .pinned-status-toggle :global(svg) {
        display: block;
    }
</style>
