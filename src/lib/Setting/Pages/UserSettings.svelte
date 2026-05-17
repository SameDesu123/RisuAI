<script lang="ts">
    import localforage from "localforage";
    import { language } from "src/lang";
    import { hubURL } from "src/ts/characterCards";
    import { loadRisuAccountBackup, loadRisuAccountData, saveRisuAccountData } from "src/ts/drive/accounter";
    
    import { DBState } from 'src/ts/stores.svelte';
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import { alertConfirm, alertError, alertNormal } from "src/ts/alert";
    import { forageStorage, loadInternalBackup } from "src/ts/globalApi.svelte";
    import { isTauri, isNodeServer } from "src/ts/platform"
    import { unMigrationAccount } from "src/ts/storage/accountStorage";
    import { checkDriver } from "src/ts/drive/drive";
    import { LoadLocalBackup, SaveLocalBackup, SavePartialLocalBackup } from "src/ts/drive/backuplocal";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import { exportAsDataset } from "src/ts/storage/exportAsDataset";
    import { loginToSionyw, testSionywLogin } from "src/ts/sionyw";
    import { cleanColdStorage } from "src/ts/process/coldstorage.svelte";
    import {
        getWorkspaceDirectoryHandle,
        isWorkspaceDirectoryStorage,
        readStorageConfig,
        setStandardDatabaseStorageMode,
        setWorkspaceDirectoryStorageMode,
        type StorageMode,
    } from "src/ts/storage/storageConfig";
    import { convertStandardDatabaseToWorkspace } from "src/ts/storage/converter/standardToWorkspace";
    import { convertWorkspaceToStandardDatabase, previewWorkspaceToStandardDatabase } from "src/ts/storage/converter/workspaceToStandard";
    import { OpfsStorage } from "src/ts/storage/opfsStorage";
    import type { RisuRawStorage } from "src/ts/storage/storageTypes";

    let openIframe = $state(false)
    let openIframeURL = $state('')
    let popup:Window = null
    let storageMode = $state<StorageMode>(readStorageConfig().mode)
    let workspaceBusy = $state(false)
    let workspaceStatus = $state('')

    function canUseWorkspaceDirectoryStorage() {
        return !isTauri && !isNodeServer && typeof window.showDirectoryPicker === 'function'
    }

    function refreshStorageMode() {
        storageMode = readStorageConfig().mode
    }

    function alertWorkspaceError(error: unknown) {
        alertError(error instanceof Error ? error : String(error))
    }

    async function enableWorkspaceDirectoryStorage() {
        if(workspaceBusy){
            return
        }
        if(!canUseWorkspaceDirectoryStorage()){
            alertError('Workspace folder storage is only available in browsers that support directory access.')
            return
        }
        if(isWorkspaceDirectoryStorage(readStorageConfig())){
            alertNormal('Workspace folder storage is already enabled.')
            return
        }
        if(forageStorage.isAccount || DBState.db.account?.useSync){
            alertError('Disable account sync before switching to workspace folder storage.')
            return
        }
        if(!(await alertConfirm('Convert the current standard database storage into a workspace folder? The selected folder will contain Risu workspace files.'))){
            return
        }

        let workspaceHandle: FileSystemDirectoryHandle
        try {
            workspaceHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            })
        } catch (error) {
            if(error instanceof DOMException && error.name === 'AbortError'){
                return
            }
            alertWorkspaceError(error)
            return
        }

        workspaceBusy = true
        workspaceStatus = 'Converting standard database storage to workspace folder...'
        try {
            const result = await convertStandardDatabaseToWorkspace(forageStorage, workspaceHandle)
            await setWorkspaceDirectoryStorageMode(result.workspaceId, workspaceHandle)
            refreshStorageMode()
            alertNormal('Workspace folder storage has been enabled. Risu will reload now.')
            location.reload()
        } catch (error) {
            alertWorkspaceError(error)
        } finally {
            workspaceBusy = false
            workspaceStatus = ''
        }
    }

    async function checkWorkspaceDirectoryStorage() {
        if(workspaceBusy){
            return
        }
        const config = readStorageConfig()
        if(!isWorkspaceDirectoryStorage(config)){
            alertNormal('Workspace folder storage is not enabled.')
            return
        }

        const workspaceHandle = await getWorkspaceDirectoryHandle(config.workspaceId)
        if(!workspaceHandle){
            alertError('Workspace folder handle was not found. Select the workspace folder again by converting from standard storage.')
            return
        }

        workspaceBusy = true
        workspaceStatus = 'Checking workspace folder storage...'
        try {
            const result = await previewWorkspaceToStandardDatabase(workspaceHandle)
            alertNormal(`Workspace check passed. Characters: ${result.database.characters?.length ?? 0}`)
        } catch (error) {
            alertWorkspaceError(error)
        } finally {
            workspaceBusy = false
            workspaceStatus = ''
        }
    }

    async function revertWorkspaceDirectoryStorage() {
        if(workspaceBusy){
            return
        }
        const config = readStorageConfig()
        if(!isWorkspaceDirectoryStorage(config)){
            alertNormal('Workspace folder storage is not enabled.')
            return
        }
        if(!(await alertConfirm('Convert the workspace folder back into standard database storage? The workspace folder will be kept, but Risu will switch back to database.bin storage.'))){
            return
        }

        const workspaceHandle = await getWorkspaceDirectoryHandle(config.workspaceId)
        if(!workspaceHandle){
            alertError('Workspace folder handle was not found. Cannot revert automatically.')
            return
        }

        workspaceBusy = true
        workspaceStatus = 'Converting workspace folder back to standard database storage...'
        try {
            const targetStorage = getStandardDatabaseTargetStorage()
            await convertWorkspaceToStandardDatabase(workspaceHandle, targetStorage)
            await setStandardDatabaseStorageMode()
            refreshStorageMode()
            alertNormal('Standard database storage has been restored. Risu will reload now.')
            location.reload()
        } catch (error) {
            alertWorkspaceError(error)
        } finally {
            workspaceBusy = false
            workspaceStatus = ''
        }
    }

    function getStandardDatabaseTargetStorage(): RisuRawStorage {
        if(
            !isTauri &&
            !isNodeServer &&
            window.navigator?.storage?.getDirectory &&
            FileSystemFileHandle?.prototype?.createWritable &&
            localStorage.getItem('opfs_flag!') === "able"
        ){
            return new OpfsStorage()
        }

        return localforage.createInstance({
            name: "risuai"
        }) as RisuRawStorage
    }
</script>

<svelte:window onmessage={async (e) => {
    if(e.origin.startsWith("https://sv.risuai.xyz") || e.origin.startsWith("http://127.0.0.1") || e.origin === window.location.origin){
        if(e.data.msg?.type === 'drive'){
            await loadRisuAccountData()
            DBState.db.account.data.refresh_token = e.data.msg.data.refresh_token
            DBState.db.account.data.access_token = e.data.msg.data.access_token
            DBState.db.account.data.expires_in = (e.data.msg.data.expires_in * 700) + Date.now()
            await saveRisuAccountData()
            popup.close()
        }
        else if(e.data.msg?.data.vaild){
            openIframe = false
            DBState.db.account = {
                id: e.data.msg.id,
                token: e.data.msg.token,
                data: e.data.msg.data
            }
        }
    }
}}></svelte:window>


<h2 class="mb-2 text-2xl font-bold mt-2">{language.account} & {language.files}</h2>

<Button
    onclick={async () => {
        if(await alertConfirm(language.backupConfirm)){
            SaveLocalBackup()
        }
    }} className="mt-2">
    {language.saveBackupLocal}
</Button>

<Button
    onclick={async () => {
        if(await alertConfirm(language.backupConfirm)){
            SavePartialLocalBackup()
        }
    }} className="mt-2">
    {language.savePartialLocalBackup}
</Button>

<Button
    onclick={async () => {
        if((await alertConfirm(language.backupLoadConfirm)) && (await alertConfirm(language.backupLoadConfirm2))){
            LoadLocalBackup()
        }
    }} className="mt-2">
    {language.loadBackupLocal}
</Button>

{#if !forageStorage.isAccount}
    <Button
        onclick={async () => {
            if((await alertConfirm(language.backupLoadConfirm)) && (await alertConfirm(language.backupLoadConfirm2))){
                loadInternalBackup()
            }
        }} className="mt-2">
        {language.loadInternalBackup}
    </Button>
{:else}
    <Button
        onclick={async () => {
            loadRisuAccountBackup()
        }} className="mt-2">
        {language.loadAutoServerBackup}
    </Button>
{/if}

<Button
    onclick={async () => {
        cleanColdStorage()
    }} className="mt-2">
    {language.cleanColdStorage}
</Button>

<Button
    onclick={async () => {
        if(await alertConfirm(language.backupConfirm)){
            localStorage.setItem('backup', 'save')
            
            if(isTauri || isNodeServer){
                checkDriver('savetauri')
            }
            else{
                checkDriver('save')
            }
        }
    }} className="mt-2">
    {language.savebackup}
</Button>

<Button
    onclick={async () => {
        if((await alertConfirm(language.backupLoadConfirm)) && (await alertConfirm(language.backupLoadConfirm2))){
            localStorage.setItem('backup', 'load')
            if(isTauri || isNodeServer){
                checkDriver('loadtauri')
            }
            else{
                checkDriver('load')
            }
        }
    }}
    className="mt-2">
    {language.loadbackup}
</Button>

<Button onclick={exportAsDataset} className="mt-2">
    {language.exportAsDataset}
</Button>

<div class="bg-darkbg p-3 rounded-md mb-2 flex flex-col items-start mt-2 gap-2">
    <div class="w-full">
        <h1 class="text-3xl font-black min-w-0">Risu Workspace Storage</h1>
    </div>
    <span class="text-textcolor2">Current storage mode: {storageMode === 'workspace-directory' ? 'Workspace folder' : 'Standard database'}</span>
    <span class="text-textcolor2 text-sm">Workspace folder storage splits Risu data into a selected local folder. Standard database storage keeps using database.bin.</span>
    {#if workspaceStatus}
        <span class="text-textcolor2 text-sm">{workspaceStatus}</span>
    {/if}
    <div class="flex flex-wrap gap-2">
        <Button onclick={enableWorkspaceDirectoryStorage} disabled={workspaceBusy || storageMode === 'workspace-directory' || !canUseWorkspaceDirectoryStorage()}>
            Convert to Workspace Folder
        </Button>
        <Button onclick={checkWorkspaceDirectoryStorage} disabled={workspaceBusy || storageMode !== 'workspace-directory'} styled="outlined">
            Check Workspace
        </Button>
        <Button onclick={revertWorkspaceDirectoryStorage} disabled={workspaceBusy || storageMode !== 'workspace-directory'} styled="danger">
            Revert to Standard Database
        </Button>
    </div>
    {#if !canUseWorkspaceDirectoryStorage()}
        <span class="text-textcolor2 text-sm">Workspace folder storage requires browser directory access support.</span>
    {/if}
</div>

<div class="bg-darkbg p-3 rounded-md mb-2 flex flex-col items-start mt-2">
    <div class="w-full">
        <h1 class="text-3xl font-black min-w-0">Risu Account{#if DBState.db.account}
            <button class="bg-selected p-1 text-sm font-light rounded-md hover:bg-blue-500 transition-colors float-right" onclick={async () => {
                if(DBState.db.account.useSync || forageStorage.isAccount){
                    unMigrationAccount()
                }
                
                DBState.db.account = undefined
            }}>{language.logout}</button>
                {#if import.meta.env.DEV}
                <button class="bg-selected p-1 text-sm font-light rounded-md hover:bg-blue-500 transition-colors float-right" onclick={async () => {
                    loginToSionyw()
                }}>{language.loginSionyw}</button>

                <button class="bg-selected p-1 text-sm font-light rounded-md hover:bg-blue-500 transition-colors float-right" onclick={async () => {
                    testSionywLogin()
                }}>TestSionyw</button>
            {/if}
        {/if}</h1>
    </div>
    {#if DBState.db.account}
        <span class="mb-4 text-textcolor2">ID: {DBState.db.account.id}</span>
        {#if !isTauri}
            <div class="flex items-center mt-2">
                {#if DBState.db.account.useSync || forageStorage.isAccount}
                    <Check check={true} name={language.SaveDataInAccount} onChange={(v) => {
                        if(v){
                            unMigrationAccount()
                        }
                    }}/>
                {:else}
                    <Check check={false} name={language.SaveDataInAccount} onChange={(v) => {
                        if(v){
                            localStorage.setItem('dosync', 'sync')
                            location.reload()
                        }
                    }}/>
                {/if}
            </div>
        {/if}
    {:else}
        <span>{language.notLoggedIn}</span>
        <button class="bg-selected p-2 rounded-md mt-2 hover:bg-blue-500 transition-colors" onclick={() => {
            openIframeURL = hubURL + '/hub/login'
            openIframe = true
        }}>
            Login
        </button>
    {/if}
    <!-- <Button onclick={autoServerBackup}>Auto Server Backups</Button> -->

</div>
{#if openIframe}
    <div class="fixed top-0 left-0 bg-black/50 w-full h-full flex justify-center items-center">
        <iframe src={openIframeURL} title="login" class="w-full h-full">
        </iframe>
    </div>
{/if}

<!--

    My song for dear, my old friend.

    Should old aquaintance be forgot,
    and never brought to mind?
    Should old lang syne be forgot,
    and auld lang syne?

    For auld lang syne, my dear,
    for auld lang syne,
    we'll take a cup o' kindness yet,
    for auld lang syne.

-->