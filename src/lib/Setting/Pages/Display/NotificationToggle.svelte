<script lang="ts">
    import { language } from 'src/lang';
    import { alertError } from 'src/ts/alert';
    import { DBState } from 'src/ts/stores.svelte';
    import { requestRisuNotificationPermission } from 'src/ts/notification';
    import Check from 'src/lib/UI/GUI/CheckInput.svelte';
</script>

<div class="flex items-center mt-2">
    <Check
        bind:check={DBState.db.notification}
        name={language.notification}
        onChange={async () => {
            if (!DBState.db.notification) {
                return;
            }
            if (!await requestRisuNotificationPermission()) {
                alertError(language.permissionDenied);
                DBState.db.notification = false;
            }
        }}
    />
</div>
