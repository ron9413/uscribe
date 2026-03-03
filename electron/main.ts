import { app, BrowserWindow, ipcMain, safeStorage, globalShortcut, clipboard, Notification } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import os from 'os'
import { aiService } from '../src/services/aiService'
import { AIConfig, AIProvider, RevisionAction } from '../src/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)
const robot = require('robotjs') as typeof import('robotjs')

// Constants
const NOTES_DIR = path.join (os.homedir(), 'Documents', 'uscribe')
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json')
const KEYS_FILE = path.join(app.getPath('userData'), 'keys.json')

let mainWindow: BrowserWindow | null = null

const COPY_WAIT_TIMEOUT_MS = 1000
const CLIPBOARD_POLL_INTERVAL_MS = 40
const PASTE_WAIT_MS = 150

interface RevisionShortcutPayload {
    action: RevisionAction
    customPrompt?: string
}

function getDefaultConfig(): AIConfig {
    return {
        providers: [],
        activeProvider: '',
        autoCompleteEnabled: true,
        autoCompleteDelay: 500,
        customRevisionShortcuts: [],
    }
}

function getDefaultApiKey(provider: AIProvider): string | null {
    if (provider.type === 'ollama') {
        return 'ollama'
    }
    return null
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function sendSystemShortcut(action: 'copy' | 'paste'): void {
    const key = action === 'copy' ? 'c' : 'v'
    const modifier = process.platform === 'darwin' ? 'command' : 'control'
    robot.keyTap(key, modifier)
}

function showBackgroundRevisionNotification(title: string, body?: string): void {
    if (!Notification.isSupported()) return

    try {
        const notification = new Notification({ title, body, silent: true })
        notification.show()
    } catch (error) {
        console.error('Failed to show background revision notification:', error)
    }
}

async function waitForClipboardTextChange(previousValue: string): Promise<string | null> {
    const start = Date.now()
    while (Date.now() - start < COPY_WAIT_TIMEOUT_MS) {
        const current = clipboard.readText()
        if (current !== previousValue) {
            return current
        }
        await sleep(CLIPBOARD_POLL_INTERVAL_MS)
    }
    return null
}

async function loadConfigFromDisk(): Promise<AIConfig> {
    try {
        if (!existsSync(CONFIG_FILE)) {
            const defaultConfig = getDefaultConfig()
            await fs.writeFile(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2))
            return defaultConfig
        }

        const content = await fs.readFile(CONFIG_FILE, 'utf-8')
        const parsed = JSON.parse(content) as Partial<AIConfig>
        const defaults = getDefaultConfig()
        return {
            ...defaults,
            ...parsed,
            customRevisionShortcuts: Array.isArray(parsed.customRevisionShortcuts)
                ? parsed.customRevisionShortcuts.map(shortcut => ({
                    ...shortcut,
                    scope: shortcut.scope === 'global'? 'global': 'local',
                }))
                : defaults.customRevisionShortcuts,
        }
    } catch (error) {
        console.error('Error reading config from disk:', error)
        return getDefaultConfig()
    }
}

async function getApiKeyFromDisk(provider: string): Promise<string | null> {
    try {
        if (!existsSync(KEYS_FILE)) {
            return null
        }

        const content = await fs.readFile(KEYS_FILE, 'utf-8')
        const keys = JSON.parse(content) as Record<string, string>

        if (!keys[provider]) {
            return null
        }

        const encrypted = Buffer.from(keys[provider], 'base64')
        return safeStorage.decryptString(encrypted)
    } catch (error) {
        console.error(`Error getting API key from disk for provider "${provider}":`, error)
        return null
    }
}

async function ensureActiveProviderReady(): Promise<string | null> {
    const config = await loadConfigFromDisk()
    const activeProviderName = config.activeProvider?.trim()
    if (!activeProviderName) {
        console.error('No active provider configured for background revision')
        return null
    }

    if (aiService.hasProvider(activeProviderName)) {
        return activeProviderName
    }

    const provider = config.providers.find((item) => item.name === activeProviderName)
    if (!provider) {
        console.error(`Active provider "${activeProviderName}" not found in config`)
        return null
    }

    let apiKey = await getApiKeyFromDisk(activeProviderName)
    if (!apiKey) {
        apiKey = getDefaultApiKey(provider)
    }

    if (!apiKey) {
        console.error(`No API key found for active provider "${activeProviderName}"`)
        return null
    }

    await aiService.initializeProvider(provider, apiKey)
    return activeProviderName
}

async function runBackgroundRevisionShortcut(payload: RevisionShortcutPayload) {
    const originalClipboardText = clipboard.readText ()
    const clipboardSentinel = `__ai_notes_clipboard_sentinel_${Date.now()}__`

    try {
        clipboard.writeText(clipboardSentinel)
        sendSystemShortcut('copy')
        const selectedText = await waitForClipboardTextChange(clipboardSentinel)
        if (!selectedText || !selectedText.trim()) {
            clipboard.writeText(originalClipboardText)
            showBackgroundRevisionNotification('AI Notes', 'No selected text found to revise.')
            return
        }

        showBackgroundRevisionNotification('AI Notes', 'Revising selected text...')

        const providerName = await ensureActiveProviderReady()
        if (!providerName) {
            showBackgroundRevisionNotification('AI Notes', 'Background revision unavailable: no active provider.')
            return
        }

        const revisedText = await aiService.reviseText(
            providerName,
            selectedText,
            payload.action,
            payload.customPrompt,
            { prefix: '', suffix: '' },
        )
        if (!revisedText || revisedText === selectedText) {
            showBackgroundRevisionNotification('AI Notes', "No revision changes were generated.")
            return
        }

        clipboard.writeText(revisedText)
        sendSystemShortcut('paste')
        await sleep(PASTE_WAIT_MS)
        showBackgroundRevisionNotification('AI Notes', 'Revision complete.')
    } catch (error) {
        console.error('Background revision shortcut failed:', error)
        showBackgroundRevisionNotification('AI Notes', 'Background revision failed.')
    } finally {
        clipboard.writeText(originalClipboardText)
    }
}

async function registerGlobalShortcuts(config?: AIConfig) {
    globalShortcut.unregisterAll()

    const activeConfig = config ?? (await loadConfigFromDisk())
    const baseShortcuts: Array<{
        accelerator: string
        label: string
        payload: RevisionShortcutPayload
        allowBackground: boolean
    }> = [
        {
            accelerator: 'CommandOrControl+Shift+1',
            label: 'Revise Text',
            payload: { action: 'revise' },
            allowBackground: true,
        },
    ]

    const customShortcuts = Array.isArray(activeConfig.customRevisionShortcuts)
        ? activeConfig.customRevisionShortcuts
        : []
    const extraShortcuts = customShortcuts
        .filter(item => (item.scope === 'global' ? 'global' : 'local') === 'global')
        .map(item => ({
            accelerator: item.accelerator,
            label: item.name || 'Custom Shortcut',
            payload: {
                action: 'custom' as const,
                customPrompt: item.prompt,
            },
            allowBackground: true,
        }))
        .filter(item => item.accelerator?.trim() && item.payload.customPrompt?.trim())

    const shortcuts = [...baseShortcuts, ...extraShortcuts]
    const seenAccelerators = new Set<string>()

    for (const shortcut of shortcuts) {
        if (seenAccelerators.has(shortcut.accelerator)) {
            console.warn(`Skipped duplicate shortcut accelerator: ${shortcut.accelerator}`)
            continue
        }
        seenAccelerators.add(shortcut.accelerator)

        const registered = globalShortcut.register(shortcut.accelerator, () => {
            const isAppFocused = mainWindow?.isFocused() ?? false
            if (isAppFocused) {
                mainWindow?.webContents.send('shortcut-revision', shortcut.payload)
                return
            }

            if (shortcut.allowBackground) {
                void runBackgroundRevisionShortcut(shortcut.payload)
            }
        })

        if (!registered) {
            console.error(
                `Failed to register shortcut ${shortcut.accelerator} for "${shortcut.label}"`,
            )
        }
    }
}

// Ensure notes directory exists
async function ensureNotesDir() {
    if (!existsSync(NOTES_DIR)) {
        await fs.mkdir(NOTES_DIR, { recursive: true })
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    })

    // Load the app
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    }

    mainWindow.on('closed', () => {
        mainWindow = null
    })
}

// IPC Handlers
ipcMain.handle('read-note', async (_, id: string) => {
    try {
        const notePath = path.join(NOTES_DIR, `${id}.json`)
        if (!existsSync(notePath)) {
            return null
        }
        const content = await fs.readFile(notePath, 'utf-8')
        return JSON.parse(content)
    } catch (error) {
        console.error('Error reading note:', error)
        return null
    }
})

ipcMain.handle('write-note', async (_, note: any) => {
    try {
        await ensureNotesDir()
        const notePath = path.join(NOTES_DIR, `${note.id}.json`)
        await fs.writeFile(notePath, JSON.stringify(note, null, 2), 'utf-8')
    } catch (error) {
        console.error ('Error writing note:', error)
        throw error
    }
})

ipcMain.handle('delete-note', async (_, id: string) => {
    try {
        const notePath = path.join(NOTES_DIR, `${id}.json`)
        if (existsSync(notePath)) {
            await fs.unlink(notePath)
        }
    } catch (error) {
        console.error('Error deleting note:', error)
        throw error
    }
})

ipcMain.handle('list-notes', async () => {
    try {
        await ensureNotesDir()
        const files = await fs.readdir(NOTES_DIR)
        const notes = []

        for (const file of files) {
            if (file.endsWith('.json')) {
                const content = await fs.readFile(path.join(NOTES_DIR, file), 'utf-8')
                const note = JSON.parse(content)
                notes.push({
                    id: note.id,
                    title: note.title,
                    createdAt: note.createdAt,
                    updatedAt: note.updatedAt,
                    folder: note.folder,
                    tags: note.tags
                })
            }
        }

        return notes.sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
    } catch (error) {
    console.error('Error listing notes:', error)
        return []
    }
})

ipcMain.handle('get-config', async () => {
    return loadConfigFromDisk()
})

ipcMain.handle('save-config', async (_, config: any) => {
    try {
        await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2))
        await registerGlobalShortcuts(config as AIConfig)
    } catch (error) {
        console.error('Error saving config:', error)
        throw error
    }
})

ipcMain.handle('store-api-key', async (_, provider: string, key: string) => {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('Encryption not available')
        }

        let keys: Record<string, string> = {}
        if (existsSync(KEYS_FILE)) {
            const content = await fs.readFile(KEYS_FILE, 'utf-8')
            keys = JSON.parse(content)
        }

        const encrypted = safeStorage.encryptString(key)
        keys[provider] = encrypted.toString('base64')

        await fs.writeFile(KEYS_FILE, JSON.stringify(keys, null, 2))
    } catch (error) {
        console.error('Error storing API key:', error)
        throw error
    }
})

ipcMain.handle('get-api-key', async (_, provider: string) => {
    return getApiKeyFromDisk(provider)
})

// App lifecycle
app.whenReady().then(() => {
    createWindow()
    void registerGlobalShortcuts()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('will-quit', () => {
    globalShortcut.unregisterAll()
})
