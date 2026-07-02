<script lang="ts">
    import Help from 'src/lib/Others/Help.svelte';
    import Check from 'src/lib/UI/GUI/CheckInput.svelte';
    import { alertConfirm, alertError } from 'src/ts/alert';
    import { clearEmergencyBackups } from 'src/ts/storage/emergencyBackup';
    import { DBState } from 'src/ts/stores.svelte';
    import { language } from 'src/lang';

    let enabled = $state(DBState.db.enableEmergencyBackup ?? false);
    let changing = false;

    $effect(() => {
        enabled = DBState.db.enableEmergencyBackup ?? false;
    });

    async function onChange(nextEnabled: boolean) {
        if (changing) {
            return;
        }

        if (nextEnabled) {
            DBState.db.enableEmergencyBackup = true;
            enabled = true;
            return;
        }

        changing = true;
        const confirmed = (
            await alertConfirm(language.emergencyBackup.disableConfirm) &&
            await alertConfirm(language.emergencyBackup.disableConfirm2)
        );

        if (confirmed) {
            try {
                await clearEmergencyBackups();
                DBState.db.enableEmergencyBackup = false;
                enabled = false;
            } catch (error) {
                console.warn('Failed to clear emergency backups:', error);
                alertError(error instanceof Error ? error : String(error));
                enabled = true;
            }
        } else {
            enabled = true;
        }

        changing = false;
    }
</script>

<div class="flex items-center mt-4">
    <Check bind:check={enabled} name={language.enableEmergencyBackup} {onChange}>
        <Help key="emergencyBackup" />
    </Check>
</div>
