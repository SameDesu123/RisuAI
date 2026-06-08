<script lang="ts">
    import { language } from "src/lang";

    let submenu = $state(0);
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.statistics}</h2>

<div class="flex w-full rounded-md border border-darkborderc mb-4">
    <button onclick={() => {
        submenu = 0
    }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 0}>
        <span>Model Usage</span>
    </button>
    <button onclick={() => {
        submenu = 1
    }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 1}>
        <span>Pricing</span>
    </button>
    <button onclick={() => {
        submenu = 2
    }} class="p-2 flex-1" class:bg-darkbutton={submenu === 2}>
        <span>Settings</span>
    </button>
</div>
