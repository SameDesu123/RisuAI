import { isTauri } from './platform'

export async function requestRisuNotificationPermission() {
    if (isTauri) {
        const {
            isPermissionGranted,
            requestPermission,
        } = await import('@tauri-apps/plugin-notification')
        if (await isPermissionGranted()) {
            return true
        }
        return await requestPermission() === 'granted'
    }

    if (!('Notification' in window)) {
        return false
    }
    if (Notification.permission === 'granted') {
        return true
    }
    return await Notification.requestPermission() === 'granted'
}

export async function sendRisuNotification(body: string) {
    if (!await requestRisuNotificationPermission()) {
        return false
    }

    if (isTauri) {
        const { sendNotification } = await import('@tauri-apps/plugin-notification')
        sendNotification({
            title: 'Risuai',
            body,
        })
        return true
    }

    const notification = new Notification('Risuai', { body })
    notification.onclick = () => window.focus()
    return true
}
