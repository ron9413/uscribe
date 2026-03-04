import { app, BrowserWindow, ipcMain, safeStorage, globalShortcut, clipboard, Notification } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { execFile } from 'child_process'
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
const APP_NAME = 'uScribe'
const NOTES_DIR = path.join(os.homedir(), 'Documents', APP_NAME.toLowerCase())
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json')
const KEYS_FILE = path.join(app.getPath('userData'), 'keys.json')

let mainWindow: BrowserWindow | null = null
let backgroundPromptWindow: BrowserWindow | null = null
let isBackgroundRevisionRunning = false

const COPY_WAIT_TIMEOUT_MS = 1000
const CLIPBOARD_POLL_INTERVAL_MS = 40
const PASTE_WAIT_MS = 150
const APP_REFOCUS_WAIT_MS = 120
const BACKGROUND_PROMPT_CHANNEL = 'background-custom-prompt-response'

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

type SourceAppReference = 
    | {
        platform: 'darwin'
        bundleId: string
      }
    | {
        platform: 'win32'
        processId: number
        windowHandle: string
      }
    | {
        platform: 'linux'
        windowId: string
      }

function runCommand(file: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(file, args, (error, stdout) => {
            if (error) {
                reject(error)
                return
            }
            resolve(stdout.trim())
        })
    })
}

function runAppleScript(script: string): Promise<string> {
    return runCommand('osascript', ['-e', script])
}

function escapeAppleScriptString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function normalizeLinuxWindowId(rawWindowId: string): { decimal: string; hex: string } | null {
    const value = rawWindowId.trim().toLowerCase()
    if (!value) return null

    const parsed = value.startsWith('0x')
        ? Number.parseInt(value.slice(2), 16)
        : Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) return null

    return {
        decimal: String(parsed),
        hex: `0x${parsed.toString(16)}`,
    }
}

async function getForegroundSourceApp(): Promise<SourceAppReference | null> {
    try {
        if (process.platform === 'darwin') {
            const bundleId = await runAppleScript(
                'tell application "System Events" to get the bundle identifier of first process whose frontmost is true',
            )
            if (!bundleId) return null
            return { platform: 'darwin', bundleId }
        }

        if (process.platform === 'win32') {
            const script = `
Add=Type@"
using System;
using System.Runtime.InteropServices;
public static class User32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [User32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { exit 1 }
$pid = 0
[User32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
Write-Output "$pid,$($hwnd.ToInt64())"
            `
            const result = await runCommand('powershell.exe', ['-NoProfile', '-Command', script])
            const [pidText, hwndText] = result.split('|')
            const processId = Number.parseInt(pidText ?? '', 10)
            if (!Number.isFinite(processId) || !hwndText) return null
            return { platform: 'win32', processId, windowHandle: hwndText.trim() }
        }

        if (process.platform === 'linux') {
            try {
                const windowId = await runCommand('xdotool', ['getactivewindow'])
                if (!windowId) return null
                return { platform: 'linux', windowId: windowId.trim() }
            } catch {
                const result = await runCommand('xprop', ['-root', '_NET_ACTIVE_WINDOW'])
                const match = result.match(/0x[0-9a-fA-F]+/)
                if (!match?.[0]) return null
                return { platform: 'linux', windowId: match[0] }
            }
        }
    } catch (error) {
        console.error('Failed to determine foreground source app:', error)
    }

    return null
}

async function reactivateSourceApp(sourceApp: SourceAppReference | null): Promise<void> {
    if (!sourceApp) return

    try {
        if (sourceApp.platform === 'darwin') {
            await runAppleScript(`tell application id "${escapeAppleScriptString(sourceApp.bundleId)}" to activate`)
            await sleep(APP_REFOCUS_WAIT_MS)
            return
        }

        if (sourceApp.platform === 'win32') {
            const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class User32 {
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$hWndValue = ${sourceApp.windowHandle}
$hWnd = [IntPtr]::new([Int64]$hWndValue)
[User32]::ShowWindowAsync($hWnd, 9) | Out-Null
$ok = [User32]::SetForegroundWindow($hWnd)
if (-not $ok) {
    $wshell = New-Object -ComObject wscript.shell
    $ok = $wshell.AppActivate(${sourceApp.processId})
    if (-not $ok) { exit 1 }
}
            `
            await runCommand('powershell.exe', ['-NoProfile', '-Command', script])
            await sleep(APP_REFOCUS_WAIT_MS)
            return
        }

        if (sourceApp.platform === 'linux') {
            const normalizedWindowId = normalizeLinuxWindowId(sourceApp.windowId)
            if (!normalizedWindowId) return

            try {
                await runCommand('xdotool', ['windowactivate', '--sync', normalizedWindowId.decimal])
            } catch {
                await runCommand('wmctrl', ['-ia', normalizedWindowId.hex])
            }
            await sleep(APP_REFOCUS_WAIT_MS)
        }
    } catch (error) {
        console.error('Failed to reactivate source app:', error)
    }
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

async function promptForBackgroundCustomInstruction(sourceAppBundleId?: SourceAppReference | null) : Promise<string | null> {
    if (backgroundPromptWindow && !backgroundPromptWindow.isDestroyed()) {
        backgroundPromptWindow.focus()
        return null
    }

    return new Promise((resolve) => {
        let settled = false

        const finish = (value: string | null) => {
            if (settled) return
            settled = true
            ipcMain.removeListener(BACKGROUND_PROMPT_CHANNEL, handlePromptResponse)
            resolve(value?.trim() ? value.trim() : null)
        }

        const handlePromptResponse = (_event: Electron.IpcMainEvent, value?: string) => {
            const shouldReturnFocusToSource = typeof value === 'string'
            finish(shouldReturnFocusToSource ? value : null)

            void (async () => {
                if (shouldReturnFocusToSource) {
                    await reactivateSourceApp(sourceAppBundleId ?? null)
                }
                if (backgroundPromptWindow && !backgroundPromptWindow.isDestroyed()) {
                    backgroundPromptWindow.close()
                }
            })()
        }

        ipcMain.on(BACKGROUND_PROMPT_CHANNEL, handlePromptResponse)

        backgroundPromptWindow = new BrowserWindow({
            width: 520,
            height: 92,
            resizable: false,
            minimizable: false,
            maximizable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            frame: false,
            transparent: true,
            hasShadow: true,
            backgroundColor: '#00000000',
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                sandbox: false
            },
        })

        const html = `
<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <title>${APP_NAME} Quick Edit</title>
    <style>
        body {
            margin: 0;
            padding: 10px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: transparent;
        }
        .shell {
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.96);
            border: 1px solid #efe7eb;
            box-shadow: 0 12px 28px rgba(15, 23, 42, 0.2);
            padding: 8px;
        }
        textarea {
            width: 100%;
            min-height: 40px;
            max-height: 180px;
            resize: none;
            border: none;
            border-radius: 10px;
            padding: 10px 12px;
            font-size: 14px;
            line-height: 1.4;
            box-sizing: border-box;
            outline: none;
            font-family: inherit;
            color: #111827;
            background: #ffffff;
            overflow-y: auto;
        }
        textarea:focus {
            box-shadow: none;
        }
    </style>
</head>
<body>
    <div class="shell">
        <textarea id="prompt" rows="1" placeholder="Type custom instruction..."></textarea>
    </div>
    <script>
        const { ipcRenderer } = require('electron')
        const promptEl = document.getElementById('prompt')
        const sendResult = (value) => ipcRenderer.send('${BACKGROUND_PROMPT_CHANNEL}', value)

        const autoResize = () => {
            promptEl.style.height = 'auto'
            const nextHeight = Math.min(Math.max(promptEl.scrollHeight, 40), 180)
            promptEl.style.height = nextHeight + 'px'
        }

        promptEl.addEventListener('input', autoResize)
        promptEl.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                sendResult('')
                return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.stopPropagation()
                sendResult(promptEl.value || '')
            }
        })
        promptEl.focus()
        autoResize()
    </script>
</body>
</html>`

        backgroundPromptWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)

        backgroundPromptWindow.on('blur', () => {
            if (backgroundPromptWindow && !backgroundPromptWindow.isDestroyed()) {
                backgroundPromptWindow.close()
            }
        })

        backgroundPromptWindow.on('closed', () => {
            backgroundPromptWindow = null
            finish(null)
        })
    })
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

async function captureSelectedText(): Promise<string | null> {
    const clipboardSentinel = `__${APP_NAME}_clipboard_sentinel_${Date.now()}__`
    clipboard.writeText(clipboardSentinel)
    sendSystemShortcut('copy')
    return waitForClipboardTextChange(clipboardSentinel)
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

async function runBackgroundRevisionShortcut(
    payload: RevisionShortcutPayload,
    options: {
        sourceAppBundleId?: SourceAppReference | null
        selectedText?: string
    } = {},
) {
    if (isBackgroundRevisionRunning) {
        showBackgroundRevisionNotification(APP_NAME, 'Background revision already in progress.')
        return
    }

    if (payload.action === 'custom' && !payload.customPrompt?.trim()) {
        showBackgroundRevisionNotification(APP_NAME, 'Custom instruction is required.')
        return
    }

    isBackgroundRevisionRunning = true
    const originalClipboardText = clipboard.readText()
    const sourceAppBundleId = options.sourceAppBundleId ?? (await getForegroundSourceApp())

    try {
        const selectedText = options.selectedText ?? (await captureSelectedText())
        if (!selectedText || !selectedText.trim()) {
            clipboard.writeText(originalClipboardText)
            showBackgroundRevisionNotification(APP_NAME, 'No selected text found to revise.')
            return
        }

        showBackgroundRevisionNotification(APP_NAME, 'Revising selected text...')

        const providerName = await ensureActiveProviderReady()
        if (!providerName) {
            showBackgroundRevisionNotification(APP_NAME, 'Background revision unavailable: no active provider.')
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
            showBackgroundRevisionNotification(APP_NAME, "No revision changes were generated.")
            return
        }

        clipboard.writeText(revisedText)
        await reactivateSourceApp(sourceAppBundleId)
        sendSystemShortcut('paste')
        await sleep(PASTE_WAIT_MS)
        showBackgroundRevisionNotification(APP_NAME, 'Revision complete.')
    } catch (error) {
        console.error('Background revision shortcut failed:', error)
        showBackgroundRevisionNotification(APP_NAME, 'Background revision failed.')
    } finally {
        clipboard.writeText(originalClipboardText)
        isBackgroundRevisionRunning = false
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
        {
            accelerator: 'CommandOrControl+Shift+2',
            label: 'Quick Edit',
            payload: { action: 'custom' },
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
                void (async () => {
                    const sourceAppBundleId = await getForegroundSourceApp()

                    if (shortcut.payload.action === 'custom' && !shortcut.payload.customPrompt?.trim()) {
                        const originalClipboardText = clipboard.readText()
                        try {
                            const selectedText = await captureSelectedText()
                            if (!selectedText || !selectedText.trim()) {
                                showBackgroundRevisionNotification(APP_NAME, 'No selected text found to revise.')
                                return
                            }

                            const customPrompt = await promptForBackgroundCustomInstruction(sourceAppBundleId)
                            if (!customPrompt) return

                            await runBackgroundRevisionShortcut(
                                {
                                    action: 'custom',
                                    customPrompt,
                                },
                                {
                                    sourceAppBundleId,
                                    selectedText,
                                },
                            )
                        } finally {
                            clipboard.writeText(originalClipboardText)
                        }
                        return
                    }

                    await runBackgroundRevisionShortcut(shortcut.payload, { sourceAppBundleId })
                })()
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
