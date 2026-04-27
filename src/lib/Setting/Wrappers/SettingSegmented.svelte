<script lang="ts">
    import type { SettingItem, SettingContext } from 'src/ts/setting/types';
    import { getLabel, getSettingValue, setSettingValue } from 'src/ts/setting/utils';
    import SegmentedControl from 'src/lib/UI/GUI/SegmentedControl.svelte';
    import Help from 'src/lib/Others/Help.svelte';
    import { language } from 'src/lang';
    import { untrack } from 'svelte';

    interface Props {
        item: SettingItem;
        ctx: SettingContext;
    }

    let { item, ctx }: Props = $props();
    let localValue: any = $state(untrack(() => getSettingValue(item, ctx)));

    // Transform options: filter by condition + resolve labelKey translations
    let processedOptions = $derived((item.options?.segmentOptions ?? [])
        .filter(opt => !opt.condition || opt.condition(ctx))
        .map(opt => ({
            value: opt.value,
            label: opt.labelKey ? ((language as any)[opt.labelKey] ?? opt.label ?? '') : (opt.label ?? '')
        })));

    // Reset value if current selection becomes hidden due to condition changes
    $effect(() => {
        const currentVal = getSettingValue(item, ctx);
        if (processedOptions.length > 0 && currentVal !== undefined && !processedOptions.some(o => o.value === currentVal)) {
            setSettingValue(item, processedOptions[processedOptions.length - 1].value, ctx);
        }
    });

    $effect(() => {
        localValue = getSettingValue(item, ctx);
    });

    $effect(() => {
        const val = localValue;
        untrack(() => {
            if (val !== getSettingValue(item, ctx)) {
                setSettingValue(item, val, ctx);
            }
        });
    });
</script>

<div class={item.containerClasses ?? ''}>
    <span class="text-textcolor {item.classes ?? ''}">
        {getLabel(item)}
        {#if item.helpKey}<Help key={item.helpKey as any}/>{/if}
    </span>
    <SegmentedControl
        bind:value={localValue}
        options={processedOptions}
    />
</div>
