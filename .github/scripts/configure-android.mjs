import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const androidRoot = resolve('src-tauri/gen/android')
const manifestPath = resolve(androidRoot, 'app/src/main/AndroidManifest.xml')
const gradlePath = resolve(androidRoot, 'app/build.gradle.kts')

let manifest = readFileSync(manifestPath, 'utf8')

const manifestEntries = [
    '<uses-permission android:name="android.permission.INTERNET" />',
    '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
    '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
    '<uses-feature android:name="android.hardware.microphone" android:required="false" />',
]

for (const entry of manifestEntries) {
    const name = entry.match(/android:name="([^"]+)"/)?.[1]
    if (name && !manifest.includes(`android:name="${name}"`)) {
        manifest = manifest.replace(/(<manifest\b[^>]*>)/, `$1\n    ${entry}`)
    }
}

manifest = manifest.replace(/<activity\b([^>]*)>/, (activity, attributes) => {
    if (/android:windowSoftInputMode=/.test(attributes)) {
        return activity.replace(
            /android:windowSoftInputMode="[^"]*"/,
            'android:windowSoftInputMode="adjustResize"',
        )
    }
    return `<activity${attributes} android:windowSoftInputMode="adjustResize">`
})

if (!manifest.includes('risuailocal')) {
    const deepLinkIntent = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="risuailocal" />
            </intent-filter>`
    manifest = manifest.replace('</activity>', `${deepLinkIntent}\n        </activity>`)
}

writeFileSync(manifestPath, manifest)

const gradle = readFileSync(gradlePath, 'utf8')
const compileSdk = Number(gradle.match(/compileSdk\s*=\s*(\d+)/)?.[1])
const targetSdk = Number(gradle.match(/targetSdk\s*=\s*(\d+)/)?.[1])
if (
    !Number.isFinite(compileSdk) ||
    !Number.isFinite(targetSdk) ||
    compileSdk < 35 ||
    targetSdk < 35
) {
    throw new Error(`Android SDK level is too old: compileSdk=${compileSdk}, targetSdk=${targetSdk}`)
}

console.log(`Configured Android project (compileSdk=${compileSdk}, targetSdk=${targetSdk})`)
