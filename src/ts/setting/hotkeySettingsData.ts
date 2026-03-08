import type { SettingItem } from './types';
import type { Hotkey } from '../defaulthotkeys';
import { language } from 'src/lang';

const isMac = typeof navigator !== 'undefined' &&
    (navigator.platform.toUpperCase().includes('MAC') || navigator.userAgent.toUpperCase().includes('MAC'));
const ctrlLabel = isMac ? 'Command' : 'Ctrl';
const altLabel = isMac ? 'Option' : 'Alt';

function hotkeyToString(h: Hotkey): string {
    const parts: string[] = [];
    if (h.ctrl) parts.push(ctrlLabel);
    if (h.shift) parts.push('Shift');
    if (h.alt) parts.push(altLabel);
    parts.push(h.key === ' ' ? 'SPACE' : h.key?.toLocaleUpperCase());
    return parts.join('+');
}

export const hotkeySettingsItems: SettingItem[] = [
    {
        id: 'hotkey.duplicateWarning',
        type: 'alert',
        labelKey: 'duplicateHotkey',
        options: {
            alertLevel: 'warning',
        },
        getValue: (db) => {
            const hotkeys = db.hotkeys;
            const result: string[] = [];
            for (let i = 0; i < hotkeys.length; i++) {
                for (let j = i + 1; j < hotkeys.length; j++) {
                    const a = hotkeys[i];
                    const b = hotkeys[j];
                    if (
                        a.key?.toLowerCase() === b.key?.toLowerCase() &&
                        !!a.ctrl === !!b.ctrl &&
                        !!a.shift === !!b.shift &&
                        !!a.alt === !!b.alt
                    ) {
                        const nameA = language.hotkeyDesc[a.action] ?? a.action;
                        const nameB = language.hotkeyDesc[b.action] ?? b.action;
                        result.push(`${nameA} / ${nameB} (${hotkeyToString(a)})`);
                    }
                }
            }
            return result;
        },
    },
    {
        id: 'hotkey.editor',
        type: 'custom',
        componentId: 'HotkeyEditor',
    },
];
