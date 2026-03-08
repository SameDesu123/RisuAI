<script lang="ts">
    import type { SettingItem, SettingContext } from 'src/ts/setting/types';
    import { getLabel, getSettingValue } from 'src/ts/setting/utils';

    interface Props {
        item: SettingItem;
        ctx: SettingContext;
    }

    let { item, ctx }: Props = $props();

    let messages: string[] = $derived.by(() => {
        const val = getSettingValue(item, ctx);
        if (!val) return [];
        if (Array.isArray(val)) return val;
        return [val];
    });

    let level = $derived(item.options?.alertLevel ?? 'warning');

    const styles = {
        info: 'text-blue-500 bg-blue-500/10 border-blue-500/30',
        warning: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30',
        error: 'text-red-500 bg-red-500/10 border-red-500/30',
    } as const;
</script>

{#if messages.length > 0}
    <div class="border rounded-lg p-3 mt-3 {styles[level]}">
        {#if getLabel(item)}
            <span class="font-bold">{getLabel(item)}</span>
        {/if}
        {#each messages as msg}
            <div class="text-sm mt-1">{msg}</div>
        {/each}
    </div>
{/if}
