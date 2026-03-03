export interface ParsedShortcut {
    accelerator: string
    error?: string
}

const MODIFIER_ALIASES: Record<string, string> = {
    command: 'Command',
    cmd: 'Command',
    meta: 'Command',
    ctrl: 'Control',
    control: 'Control',
    cmdorctrl: 'CommandOrControl',
    commandorcontrol: 'CommandOrControl',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
}

const MODIFIER_ORDER = ['CommandOrControl', 'Command', 'Control', 'Alt', 'Shift']

const KEY_ALIASES: Record<string, string> = {
    esc: "Escape",
    escape: "Escape",
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    space: "Space",
    backspace: "Backspace",
    delete: "Delete",
    del: "Delete",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
}

function normalizeShortcutKey(part: string): string | null {
    const value = part.trim()
    if (!value) return null

    const alias = KEY_ALIASES [value.toLowerCase()]
    if (alias) return alias

    if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(value)) {
        return value.toUpperCase()
    }

    if (/^[a-z]$/i.test(value)) {
        return value.toUpperCase()
    }

    if (/^[0-9]$/.test (value)) {
        return value
    }

    return null
}

export function parseShortcutInput(input: string): ParsedShortcut {
    const rawParts = input
        .split('+')
        .map(part => part.trim())
        .filter(Boolean)
    
    if (rawParts.length < 2) {
        return { accelerator: '', error: 'Use at least one modifier and one key (e.g. Cmd+Shift+3).' }
    }

    const modifiers = new Set<string>()
    let key: string | null = null

    for (const part of rawParts) {
        const modifier = MODIFIER_ALIASES[part.toLowerCase()]
        if (modifier) {
            modifiers.add(modifier)
            continue
        }

        if (key) {
            return { accelerator: '', error: 'Only one non-modifier key is allowed.' }
        }

        key = normalizeShortcutKey(part)
        if (!key) {
            return {
                accelerator: '',
                error:
                    'Unsupported key. Use letters, numbers, function keys, or Enter/Escape/Tab/Space.'
            }
        }
    }

    if (!key) {
        return { accelerator: '', error: 'Shortcut must include a non-modifier key.' }
    }

    if (modifiers.size == 0) {
        return { accelerator: '', error: 'Shortcut must include at least one modifier.' }
    }

    const orderedModifiers = MODIFIER_ORDER.filter(mod => modifiers.has(mod))
    return {
        accelerator: [...orderedModifiers, key].join('+'),
    }
}

function acceleratorParts(accelerator: string): { modifiers: Set<string>; key: string | null } {
    const parts = accelerator
        .split('+')
        .map(part => part.trim())
        .filter(Boolean)
    
    const modifiers = new Set<string>()
    let key: string | null = null

    for (const part of parts) {
        if (MODIFIER_ORDER.includes(part)) {
            modifiers.add(part)
        } else {
            key = part
        }
    }

    return { modifiers, key }
}

function expectedModifierState(modifiers: Set<string>) {
    const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
    const expectMeta = modifiers.has('Command') || (isMac && modifiers.has('CommandOrControl'))
    const expectCtrl = modifiers.has('Control') || (!isMac && modifiers.has('CommandOrControl'))
    const expectAlt = modifiers.has('Alt')
    const expectShift = modifiers.has('Shift')
    return {expectMeta, expectCtrl, expectAlt, expectShift}
}

function keyMatches(event: KeyboardEvent, key: string): boolean {
    if (/^[A-Z]$/.test(key)) {
        return event.code === `Key${key}` || event.key.toUpperCase() === key
    }

    if (/^[0-9]$/.test(key)) {
        return event.code === `Digit${key}` || event.key === key
    }

    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
        return event.key.toUpperCase() === key
    }

    const namedKeyMap: Record<string, string[]> = {
        Enter: ['Enter'],
        Escape: ['Escape', 'Esc'],
        Tab: ['Tab'],
        Space: [' ', 'Spacebar'],
        Backspace: ['Backspace'],
        Delete: ['Delete'],
        Up: ['ArrowUp'],
        Down: ['ArrowDown'],
        Left: ['ArrowLeft'],
        Right: ['ArrowRight'],
        Home: ['Home'],
        End: ['End'],
        PageUp: ['PageUp'],
        PageDown: ['PageDown'],
    }

    const candidates = namedKeyMap[key]
    return !!candidates?.includes(event.key)
}

export function matchesAccelerator(event: KeyboardEvent, accelerator: string): boolean {
    const {modifiers, key} = acceleratorParts(accelerator)
    if (!key) return false
    
    const { expectMeta, expectCtrl, expectAlt, expectShift } = expectedModifierState(modifiers)
    if (event.metaKey != expectMeta) return false
    if (event.ctrlKey != expectCtrl) return false
    if (event.altKey !== expectAlt) return false
    if (event.shiftKey !== expectShift) return false

    return keyMatches(event, key)
}

export function acceleratorToDisplay(accelerator: string): string {
    const { modifiers, key } = acceleratorParts(accelerator)
    if (!key) return accelerator

    const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
    const modifierLabels: Record<string, string> = isMac
        ? {
            CommandOrControl: '⌘',
            Command: '⌘',
            Control: '⌃',
            Alt: '⌥',
            Shift: '⇧',
          }
        : {
            CommandOrControl: 'Ctrl',
            Command: 'Meta',
            Control: 'Ctrl',
            Alt: 'Alt',
            Shift: 'Shift',
        }

    const orderedModifiers = MODIFIER_ORDER.filter(mod => modifiers.has(mod))
    const keyLabelMap: Record<string, string> = {
        Escape: isMac ? 'Esc' : 'Escape',
        Enter: 'Enter',
        Tab: 'Tab',
        Space: 'Space',
        Up: isMac ? '↑' : 'Up',
        Down: isMac ? '↓' : 'Down',
        Left: isMac ? '←' : 'Left',
        Right: isMac ? '→' : 'Right',
        PageUp: 'PgUp',
        PageDown : 'PgDn',
    }

    const keyLabel = keyLabelMap[key] || key

    if (isMac) {
        return `${orderedModifiers.map(mod => modifierLabels[mod]).join('')}${keyLabel}`
    }

    return [...orderedModifiers.map(mod => modifierLabels[mod]), keyLabel].join('+')
}
