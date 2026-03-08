<script lang="ts">
    import SettingRenderer from "../SettingRenderer.svelte";
    import { hotkeySettingsItems } from "src/ts/setting/hotkeySettingsData";
</script>

<SettingRenderer items={hotkeySettingsItems} />
