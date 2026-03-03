import {Note, NoteMetadata, AIConfig} from '../types'

class StorageService {
    async listNotes(): Promise<NoteMetadata[]> {
        return window.electronAPI.listNotes()
    }

    async readNote(id: string): Promise<Note | null> {
        return window.electronAPI.readNote(id)
    }

    async writeNote(note: Note): Promise<void> {
        return window.electronAPI.writeNote(note)
    }

    async deleteNote(id: string): Promise<void> {
        return window.electronAPI.deleteNote(id)
    }

    async getConfig(): Promise<AIConfig> {
        return window.electronAPI.getConfig()
    }

    async saveConfig(config: AIConfig): Promise<void> {
        return window.electronAPI.saveConfig(config)
    }

    async storeApiKey(provider: string, key: string): Promise<void> {
        return window.electronAPI.storeApiKey(provider, key)
    }

    async getApikey(provider: string): Promise<string | null> {
        return window.electronAPI.getApiKey(provider)
    }
}

export const storageService = new StorageService()
