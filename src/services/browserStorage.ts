import { Note, NoteMetadata, AIConfig, ElectronAPI } from '../types'

// Browser-based storage implementation using localStorage
// This is a fallback for when the app runs in a browser (not Electron)
class BrowserStorage implements ElectronAPI {
    private readonly NOTES_KEY = "uscribe-storage"
    private readonly CONFIG_KEY = 'uscribe-config'
    private readonly API_KEYS_KEY = 'uscribe-api-keys'

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
        })).sort ((a, b) =>
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
            return {
                ...defaultConfig,
                ...parsed,
                customRevisionShortcuts: Array.isArray(parsed.customRevisionShortcuts)
                    ? parsed.customRevisionShortcuts.map((shortcut) => ({
                        ...shortcut,
                        scope: shortcut.scope === 'global' ? 'global' : 'local',
                    }))
                    : [],
            }
        } catch (error) {
            return defaultConfig
        }
    }

    async saveConfig(config: AIConfig): Promise<void> {
        localStorage.setItem(this.CONFIG_KEY, JSON.stringify(config))
    }

    async storeApiKey(provider: string, key: string): Promise<void> {
        const keys = this.getAllApiKeys()
        keys[provider] = key
        localStorage.setItem(this.API_KEYS_KEY, JSON.stringify(keys))
    }

    async getApiKey(provider: string): Promise<string | null> {
        const keys = this.getAllApiKeys()
        return keys[provider] || null
    }

    private getAllNotes(): Record<string, Note> {
        const notesStr = localStorage.getItem(this.NOTES_KEY)
        if (!notesStr) {
            return {}
        }
        try {
            return JSON.parse(notesStr)
        } catch (error) {
            return {}
        }
    }

    private getAllApiKeys(): Record<string, string> {
        const keysStr = localStorage.getItem(this.API_KEYS_KEY)
        if (!keysStr) {
            return {}
        }
        try {
            return JSON.parse(keysStr)
        } catch (error) {
            return {}
        }
    }
}

// Export a singleton instance
export const browserStorage = new BrowserStorage()

// Helper to get the appropriate storage implementation
export function getStorage(): ElectronAPI {
    // Check if we're running in Electron
    if (typeof window != 'undefined' && window.electronAPI) {
        return window. electronAPI
    }
    //Fallback to browser storage
    if (typeof window != 'undefined' && !window.electronAPI) {
        // Only log once
        if (!sessionStorage.getItem('browser-storage-warning')) {
            console.warn('⚠️ Running in browser mode. Using localStorage instead of secure Electron storage.')
            console.info('💡 For production use, run the Electron app for secure API key storage.')
            sessionStorage.setItem('browser-storage-warning', 'true')
        }
    }
    return browserStorage
}
