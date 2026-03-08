<script lang="ts">
    import { language } from "src/lang";
    import { DBState } from "src/ts/stores.svelte";
    import type { Hotkey } from "src/ts/defaulthotkeys";

    const isMac = navigator.platform.toUpperCase().includes('MAC') || navigator.userAgent.toUpperCase().includes('MAC');
    const ctrlLabel = isMac ? 'Command' : 'Ctrl';
    const altLabel = isMac ? 'Option' : 'Alt';

    function hotkeyToString(h: Hotkey): string {
        const parts: string[] = [];
        if (h.ctrl) parts.push(ctrlLabel);
        if (h.shift) parts.push('Shift');
        if (h.alt) parts.push(altLabel);
        parts.push(h.key === ' ' ? 'SPACE' : h.key?.toLocaleUpperCase());
        return parts.join('+');
    }

    let duplicates = $derived.by(() => {
        const hotkeys = DBState.db.hotkeys;
        const result: string[] = [];
        for (let i = 0; i < hotkeys.length; i++) {
            for (let j = i + 1; j < hotkeys.length; j++) {
                const a = hotkeys[i];
                const b = hotkeys[j];
                if (
                    a.key?.toLowerCase() === b.key?.toLowerCase() &&
                    !!a.ctrl === !!b.ctrl &&
                    !!a.shift === !!b.shift &&
                    !!a.alt === !!b.alt
                ) {
                    const nameA = language.hotkeyDesc[a.action] ?? a.action;
                    const nameB = language.hotkeyDesc[b.action] ?? b.action;
                    result.push(`${nameA} / ${nameB} (${hotkeyToString(a)})`);
                }
            }
        }
        return result;
    });
</script>

{#if window.innerWidth < 768}
    <span class="text-red-500">
        {language.screenTooSmall}
    </span>
{:else}
    {#if duplicates.length > 0}
        <div class="text-yellow-500 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-3">
            <span class="font-bold">{language.duplicateHotkey}</span>
            {#each duplicates as dup}
                <div class="text-sm mt-1">{dup}</div>
            {/each}
        </div>
    {/if}
    <table>
        <thead>
            <tr>
                <th>{language.hotkey}</th>
            </tr>
        </thead>
        <tbody>
            {#each DBState.db.hotkeys as hotkey}
                <tr>
                    <td>{language.hotkeyDesc[hotkey.action]}</td>
                    <td>
                        <button
                            class:text-textcolor={hotkey.ctrl}
                            class:text-textcolor2={!hotkey.ctrl}
                            onclick={() => {
                                hotkey.ctrl = !hotkey.ctrl;
                            }}
                        >
                            {ctrlLabel}
                        </button>
                    </td>
                    <td>
                        <button
                            class:text-textcolor={hotkey.shift}
                            class:text-textcolor2={!hotkey.shift}
                            onclick={() => {
                                hotkey.shift = !hotkey.shift;
                            }}
                        >
                            Shift
                        </button>
                    </td>
                    <td>
                        <button
                            class:text-textcolor={hotkey.alt}
                            class:text-textcolor2={!hotkey.alt}
                            onclick={() => {
                                hotkey.alt = !hotkey.alt;
                            }}
                        >
                            {altLabel}
                        </button>
                    </td>
                    <td>
                        <input
                            value={hotkey.key === ' ' ? "SPACE" : hotkey.key?.toLocaleUpperCase()}
                            class="bg-bgcolor border-none w-16"
                            onkeydown={(e) => {
                                e.preventDefault();
                                hotkey.key = e.key;
                            }}
                        >
                    </td>
                </tr>
            {/each}
        </tbody>
    </table>
{/if}
