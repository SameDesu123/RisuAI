import { onBackButtonPress } from '@tauri-apps/api/app'
import { exit } from '@tauri-apps/plugin-process'
import { get } from 'svelte/store'
import { showRealmInfoStore } from './characterCards'
import { flushDbNow } from './globalApi.svelte'
import { isTauriAndroid } from './platform'
import {
    CustomGUISettingMenuStore,
    MobileGUIStack,
    MobileSideBar,
    OpenRealmStore,
    PlaygroundStore,
    QuickSettings,
    SettingsMenuIndex,
    ShowRealmFrameStore,
    alertStore,
    bookmarkListOpen,
    botMakerMode,
    customSideBarConfigDialogStore,
    easyPanelStore,
    hypaV3ModalOpen,
    irisStore,
    loadoutModalStore,
    openPersonaList,
    openPresetList,
    pluginAlertModalStore,
    popUpEditorStore,
    popupStore,
    selectedCharID,
    settingsOpen,
    sideBarStore,
} from './stores.svelte'

function closeFocusedInput() {
    const activeElement = document.activeElement
    if (!(activeElement instanceof HTMLElement)) {
        return false
    }
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName) && !activeElement.isContentEditable) {
        return false
    }
    activeElement.blur()
    return true
}

export function closeActiveAndroidLayer() {
    if (closeFocusedInput()) return true

    if (customSideBarConfigDialogStore.open) {
        customSideBarConfigDialogStore.open = false
        return true
    }
    if (irisStore.open) {
        irisStore.open = false
        return true
    }
    if (loadoutModalStore.open) {
        loadoutModalStore.open = false
        return true
    }
    if (popUpEditorStore.open) {
        popUpEditorStore.open = false
        return true
    }
    if (easyPanelStore.open) {
        easyPanelStore.open = false
        return true
    }
    if (popupStore.children) {
        popupStore.children = null
        return true
    }
    if (pluginAlertModalStore.open) {
        pluginAlertModalStore.open = false
        return true
    }
    if (QuickSettings.open) {
        QuickSettings.open = false
        return true
    }

    const activeAlert = get(alertStore)
    if (activeAlert.type !== 'none' && activeAlert.type !== 'wait' && activeAlert.type !== 'progress') {
        alertStore.set({ type: 'none', msg: '' })
        return true
    }
    if (get(hypaV3ModalOpen)) {
        hypaV3ModalOpen.set(false)
        return true
    }
    if (get(bookmarkListOpen)) {
        bookmarkListOpen.set(false)
        return true
    }
    if (get(openPersonaList)) {
        openPersonaList.set(false)
        return true
    }
    if (get(openPresetList)) {
        openPresetList.set(false)
        return true
    }
    if (get(showRealmInfoStore)) {
        showRealmInfoStore.set(null)
        return true
    }
    if (get(ShowRealmFrameStore)) {
        ShowRealmFrameStore.set('')
        return true
    }
    if (get(CustomGUISettingMenuStore)) {
        CustomGUISettingMenuStore.set(false)
        return true
    }
    if (get(settingsOpen)) {
        settingsOpen.set(false)
        return true
    }
    if (get(SettingsMenuIndex) > -1) {
        SettingsMenuIndex.set(-1)
        return true
    }
    if (get(MobileSideBar) > 0) {
        MobileSideBar.set(0)
        return true
    }
    if (get(sideBarStore) && window.innerWidth <= 1024) {
        sideBarStore.set(false)
        return true
    }
    if (get(botMakerMode)) {
        botMakerMode.set(false)
        return true
    }
    if (get(selectedCharID) !== -1) {
        selectedCharID.set(-1)
        return true
    }
    if (get(OpenRealmStore)) {
        OpenRealmStore.set(false)
        return true
    }
    if (get(PlaygroundStore) !== 0) {
        PlaygroundStore.set(0)
        return true
    }
    if (get(MobileGUIStack) !== 0) {
        MobileGUIStack.set(0)
        return true
    }

    return false
}

export async function initAndroidRuntime() {
    if (!isTauriAndroid) return

    await onBackButtonPress(async ({ canGoBack }) => {
        if (closeActiveAndroidLayer()) return
        if (canGoBack) {
            history.back()
            return
        }
        try {
            const didFlush = await Promise.race([
                flushDbNow({ forceFull: true }).then(() => true),
                new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000)),
            ])
            if (didFlush) {
                await exit(0)
            } else {
                console.error('Android exit was cancelled because the database flush did not finish')
            }
        } catch (error) {
            console.error('Failed to flush the database before Android exit:', error)
        }
    })
}
