const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')
type ElectronAPI = import('../src/types').ElectronAPI

const electronAPI: ElectronAPI = {
    readNote: (id: string) => ipcRenderer.invoke('read-note', id),
    writeNote: (note: any) => ipcRenderer.invoke('write-note', note),
    deleteNote: (id: string) => ipcRenderer.invoke('delete-note', id),
    listNotes: () => ipcRenderer.invoke('list-notes'),
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config: any) => ipcRenderer.invoke('save-config', config),
    storeApiKey: (provider: string, key: string) =>
        ipcRenderer.invoke('store-api-key', provider, key),
    getApiKey: (provider: string) => ipcRenderer.invoke('get-api-key', provider),
    initializeProvider: (provider: any, apiKey: string) =>
        ipcRenderer.invoke('initialize-ai-provider', provider, apiKey),
    generateText: (providerName: string, options: any) =>
        ipcRenderer.invoke('ai-generate-text', providerName, options),
    cancelAIRequests: () => ipcRenderer.invoke('ai-cancel-requests'),
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Listen for shortcuts
ipcRenderer.on('shortcut-revision-menu', (_, mode) => {
    window.dispatchEvent(new CustomEvent('electron-shortcut', {
        detail: { type: 'revision-menu', mode }
    }))
})

ipcRenderer.on('shortcut-revision', (_, payload) => {
    window.dispatchEvent(new CustomEvent('electron-shortcut', {
        detail: { type: 'revision', payload }
    }))
})
