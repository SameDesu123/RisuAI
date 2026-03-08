<script lang="ts">
    import SettingRenderer from "../SettingRenderer.svelte";
    import { languageSettingsItems } from "src/ts/setting/languageSettingsData";
</script>

<SettingRenderer items={languageSettingsItems} />
