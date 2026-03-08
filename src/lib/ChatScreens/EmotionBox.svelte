<script>

    import { DBState } from 'src/ts/stores.svelte';
    import { CharEmotion } from '../../ts/stores.svelte';
    import { getEmotion } from '../../ts/util';
    import { lazyBackground } from '../../ts/gui/lazyBackground';
</script>

{#await getEmotion(DBState.db,$CharEmotion, 'contain') then images}
    {#each images as image, i}
    <div use:lazyBackground={image} style={`width:${(100 / images.length)}%;bottom:0;left:${100 / images.length * i}%`} class="h-full bg-center absolute"></div>

    {/each}
{/await}

<style>
    .h-full {
        height: 100%;
    }
    .bg-center {
        background-position: center;
    }
</style>