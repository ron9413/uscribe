import { AIProvider, AITextGenerateOptions, Note, NoteMetadata, AIConfig, ElectronAPI } from '../types'
import { configContainsPlaintextApiKeys, sanitizeConfigForStorage } from '../utils/configSecurity'

// Browser-based storage implementation using localStorage
// This is a fallback for when the app runs in a browser (not Electron)
class BrowserStorage implements ElectronAPI {
    private readonly NOTES_KEY = 'uscribe-storage'
    private readonly CONFIG_KEY = 'uscribe-config'

    async readNote(id: string): Promise<Note | null> {
        const notes = this.getAllNotes()
        return notes[id] || null
    }

    async writeNote(note: Note): Promise<void> {
        const notes = this.getAllNotes()
        notes[note.id] = note
        localStorage.setItem(this.NOTES_KEY, JSON.stringify(notes))
    }

    async deleteNote(id: string): Promise<void> {
        const notes = this.getAllNotes()
        delete notes[id]
        localStorage.setItem(this.NOTES_KEY, JSON.stringify(notes))
    }

    async listNotes(): Promise<NoteMetadata[]> {
        const notes = this.getAllNotes()
        return Object.values(notes).map(note => ({
            id: note.id,
            title: note.title,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            folder: note.folder,
            tags: note.tags,
        })).sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
    }

    async getConfig(): Promise<AIConfig> {
        const defaultConfig: AIConfig = {
            providers: [],
            activeProvider: '',
            autoCompleteEnabled: true,
            autoCompleteDelay: 500,
            customRevisionShortcuts: [],
        }

        const configStr = localStorage.getItem(this.CONFIG_KEY)
        if (!configStr) {
            return defaultConfig
        }

        try {
            const parsed = JSON.parse(configStr) as Partial<AIConfig>
            const mergedConfig: AIConfig = {
                ...defaultConfig,
                ...parsed,
                customRevisionShortcuts: Array.isArray(parsed.customRevisionShortcuts)
                    ? parsed.customRevisionShortcuts.map(shortcut => ({
                        ...shortcut,
                        scope: shortcut.scope === 'global' ? 'global' : 'local',
                    }))
                    : [],
            }
            const sanitizedConfig = sanitizeConfigForStorage(mergedConfig)

            if (configContainsPlaintextApiKeys(mergedConfig)) {
                localStorage.setItem(this.CONFIG_KEY, JSON.stringify(sanitizedConfig))
                console.warn('Removed insecure plaintext API key fields from browser config.')
            }

            return sanitizedConfig
        } catch {
            return defaultConfig
        }
    }

    async saveConfig(config: AIConfig): Promise<void> {
        const sanitizedConfig = sanitizeConfigForStorage(config)
        localStorage.setItem(this.CONFIG_KEY, JSON.stringify(sanitizedConfig))
    }

    async storeApiKey(provider: string, key: string): Promise<void> {
        void provider
        void key
        throw new Error('Secure API key storage requires Electron runtime')
    }

    async getApiKey(provider: string): Promise<string | null> {
        void provider
        return null
    }

    async initializeProvider(_provider: AIProvider, _apiKey: string): Promise<void> {
        throw new Error('AI provider initialization requires Electron runtime')
    }

    async generateText(_providerName: string, _options: AITextGenerateOptions): Promise<string> {
        throw new Error('AI text generation requires Electron runtime')
    }

    async cancelAIRequests(): Promise<void> {
        // No-op in browser fallback mode
    }

    private getAllNotes(): Record<string, Note> {
        const notesStr = localStorage.getItem(this.NOTES_KEY)
        if (!notesStr) {
            return {}
        }
        try {
            return JSON.parse(notesStr)
        } catch {
            return {}
        }
    }
}

// Export a singleton instance
export const browserStorage = new BrowserStorage()

// Helper to get the appropriate storage implementation
export function getStorage(): ElectronAPI {
    // Check if we're running in Electron
    if (typeof window !== 'undefined' && window.electronAPI) {
        return window.electronAPI
    }
    // Fallback to browser storage
    if (typeof window !== 'undefined' && !window.electronAPI) {
        // Clean up legacy plaintext API key cache from older browser fallback behavior.
        localStorage.removeItem('uscribe-api-keys')
        // Only log once
        if (!sessionStorage.getItem('browser-storage-warning')) {
            console.warn('Running in browser mode. API key storage is disabled for security.')
            console.info('Run the Electron app to store API keys securely via system keychain.')
            sessionStorage.setItem('browser-storage-warning', 'true')
        }
    }
    return browserStorage
}
