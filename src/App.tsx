import { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import Editor from './components/Editor/Editor'
import Settings from './components/Settings/Settings'
import Toast from './components/Toast'
import { Note, NoteMetadata, AIConfig, AIProvider } from './types'
import { v4 as uuidv4 } from 'uuid'
import { getStorage } from './services/browserStorage'
import { aiService } from './services/aiService'

// Helper function to get default API key for providers that don't require authentication
function getDefaultApiKey(provider: AIProvider): string | null {
    switch (provider.type) {
        case 'ollama':
            return 'ollama' // Ollama doesh't require authentication
        // Add more provider types here that don't require real API keys
        default:
            return null
    }
}
    
function App() {
    const [notes, setNotes] = useState<NoteMetadata[]>([])
    const [currentNote, setCurrentNote] = useState<Note | null>(null)
    const [showSettings, setShowSettings] = useState(false)
    const [config, setConfig] = useState<AIConfig>({
        providers: [],
        activeProvider: '',
        autoCompleteEnabled: true,
        autoCompleteDelay: 500,
        customRevisionShortcuts: [],
    })
    const [toastMessage, setToastMessage] = useState<string | null>(null)
    const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const saveDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingNoteToSaveRef = useRef<Note | null>(null)
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve())

    // Load notes list on mount
    useEffect (() => {
        loadNotes()
        loadConfig()
    }, [])

    // Clear toast timeout on unmount
    useEffect (() => {
        return () => {
            if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
            if (saveDebounceTimeoutRef.current) clearTimeout(saveDebounceTimeoutRef.current)
            // Best-effort flush on unmount so the last debounced edit is not dropped.
            if (pendingNoteToSaveRef.current) {
                void flushPendingNoteSave()
            }
        }
    }, [])

    const loadNotes = async (autoSelectLatest = true) => {
        const storage = getStorage()
        const notesList = await storage.listNotes()
        setNotes(notesList)

        // When there are notes, always select the latest (list is sorted by updatedAt desc)
        if (autoSelectLatest && notesList.length > 0) {
            loadNote(notesList[0].id)
        }
    }

    const loadConfig = async () => {
        const storage = getStorage()
        const cfg = await storage.getConfig()
        setConfig(cfg)

        // Initialize AI providers
        for (const provider of cfg.providers) {
            if (!aiService.hasProvider(provider.name)) {
                try {
                    let apikey = await storage.getApiKey(provider.name)

                    // Use default key for providers that don't require authentication
                    if (!apikey) {
                        apikey = getDefaultApiKey(provider)
                    }
    
                    if (apikey) {
                        await aiService.initializeProvider(provider, apikey)
                        console.log(`Initialized AI provider: ${provider.name}`)
                    } else {
                        console.warn(`No API key found for provider: ${provider.name}`)
                    }
                } catch (error) {
                    console.error(`Failed to initialize provider ${provider.name}:`, error)
                }
            }
        }
    }

    const loadNote = async (id: string) => {
        await flushPendingNoteSave()
        const storage = getStorage()
        const note = await storage.readNote(id)
        if (note) {
            setCurrentNote(note)
        }
    }

    const createNewNote = async () => {
        await flushPendingNoteSave()
        const newNote: Note = {
            id: uuidv4(),
            title: "New Note",
            content: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }
        // Set as current note immediately so it's visible
        setCurrentNote(newNote)
        // Optimistically add to notes list so it appears in sidebar immediately
        const noteMetadata: NoteMetadata = {
            id: newNote.id,
            title: newNote.title,
            createdAt: newNote.createdAt,
            updatedAt: newNote.updatedAt,
            folder: newNote.folder,
            tags: newNote.tags,
        }
        setNotes((prevNotes) => [noteMetadata, ...prevNotes])
        // Save the note and reload notes list to ensure consistency
        await saveNote(newNote)
    }

    const upsertNoteMetadata = (note: Note) => {
        const metadata: NoteMetadata = {
            id: note.id,
            title: note.title,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            folder: note.folder,
            tags: note.tags,
        }
        setNotes((prevNotes) => {
            const withoutCurrent = prevNotes.filter((item) => item.id !== note.id)
            return [metadata, ...withoutCurrent].sort(
                (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            )
        })
    }

    const saveNote = async (note: Note) => {
        const storage = getStorage()
        saveQueueRef.current = saveQueueRef.current
            .catch(() => {
                // Keep queue alive even if a previous save failed.
            })
            .then(async () => {
                await storage.writeNote(note)
                upsertNoteMetadata(note)
            })
        return saveQueueRef.current
    }

    const flushPendingNoteSave = async () => {
        const note = pendingNoteToSaveRef.current
        if (!note) return
        pendingNoteToSaveRef.current = null
        await saveNote(note)
    }

    const scheduleSaveNote = (note: Note) => {
        pendingNoteToSaveRef.current = note
        if (saveDebounceTimeoutRef.current) clearTimeout(saveDebounceTimeoutRef.current)
        saveDebounceTimeoutRef.current = setTimeout(() => {
            void flushPendingNoteSave()
        }, 400)
    }

    const deleteNote = async (id: string) => {
        // Optimistically remove from notes list immediately
        setNotes((prevNotes) => prevNotes.filter((note) => note.id !== id))
        // Clear current note if it's the one being deleted
        if (currentNote?.id === id) {
            setCurrentNote(null)
        }
        // Delete from disk
        try {
            const storage = getStorage()
            await storage.deleteNote(id)
            // Reload notes list to ensure consistency
            await loadNotes()
        } catch (error) {
            // If deletion fails, reload notes to restore the list
            console.error('Error deleting note:', error)
            await loadNotes()
        }
    }

    const updateNote = (updates: Partial<Note>) => {
        if (!currentNote) return

        const updatedNote = {
            ...currentNote,
            ...updates,
            updatedAt: new Date().toISOString(),
        }
        setCurrentNote(updatedNote)
        scheduleSaveNote(updatedNote)
    }

    const saveConfig = async (newConfig: AIConfig) => {
        const storage = getStorage()
        await storage.saveConfig(newConfig)
        setConfig(newConfig)
    }

    const showToast = useCallback ((message: string) => {
        if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
        setToastMessage(message)
        toastTimeoutRef.current = setTimeout(() => {
            setToastMessage(null)
            toastTimeoutRef.current = null
        }, 2500)
    }, [])

    const toggleAutoComplete = () => {
        const nextEnabled = !config.autoCompleteEnabled
        saveConfig({
            ...config,
            autoCompleteEnabled: nextEnabled
        })
        showToast(nextEnabled ? 'Autocomplete on' : 'Autocomplete off')
    }

    return (
        <div className="flex h-screen bg-notes-bg flex-col">
            {/* Draggable title bar */}
            <div
                className="h-8 bg-notes-sidebar border-b border-notes-border"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            />

            <div className="flex flex-1 overflow hidden">
                <Sidebar
                    notes={notes}
                    currentNoteId={currentNote?.id}
                    onSelectNote={loadNote}
                    onNewNote={createNewNote}
                    onDeleteNote={deleteNote}
                    onOpenSettings={() => setShowSettings(true)}
                />
            
                <div className="flex-1 flex flex-col min-h-0 min-w-0">
                {notes.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                        <div className="text-center">
                            <p className="text-2xl mb-4">No notes yet</p>
                            <button
                                onClick={createNewNote}
                                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                            >
                                Create New Note
                            </button>
                        </div>
                    </div>
                ) : currentNote ? (
                    <Editor
                        note={currentNote}
                        config={config}
                        onUpdate={updateNote}
                        onToggleAutoComplete={toggleAutoComplete}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                        <p>Loading note...</p>
                    </div>
                )}
                </div>
            </div>

            {showSettings && (
                <Settings
                    config={config}
                    onSave={saveConfig}
                    onClose={() => setShowSettings(false)}
                />
            )}

            {toastMessage && (
                <Toast
                    message={toastMessage}
                    onDismiss={() => {
                        if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
                        setToastMessage(null)
                        toastTimeoutRef.current = null
                    }}
                />
            )}
        </div>
    )
}

export default App
