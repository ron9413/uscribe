import { useState } from 'react'
import { NoteMetadata } from '../../types'
import NoteItem from './NoteItem'
import SearchBar from './SearchBar'

interface SidebarProps {
    notes: NoteMetadata[]
    currentNoteId?: string
    onSelectNote: (id: string) => void
    onNewNote: () => void
    onDeleteNote: (id: string) => void
    onOpenSettings: () => void
}

function Sidebar({
    notes,
    currentNoteId,
    onSelectNote,
    onNewNote,
    onDeleteNote,
    onOpenSettings,
}: SidebarProps) {
    const [searchQuery, setSearchQuery] = useState('')

    const filteredNotes = notes.filter((note) => 
        note.title.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const groupedNotes = filteredNotes.reduce((acc, note) => {
        const folder = note.folder || 'Notes'
        if (!acc[folder]) {
            acc[folder] = []
        }
        acc[folder].push(note)
        return acc
    }, {} as Record<string, NoteMetadata[]>)

    return (
        <div className="w-80 bg-notes-sidebar border-r border-notes-border flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-notes-border">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-notes-text">Notes</h2> 
                    <div className="flex items-center gap-1">
                        <button
                            onClick={onNewNote}
                            className="p-2 hover:bg-gray-300 rounded"
                            title="Create a note"
                            aria-label="Create a note"
                            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                        >
                            <svg
                                className="w-5 h-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M16.862 4.487a2.1 2.1 0 113 2.969L9.75 17.57 6 18l.431-3.75L16.862 4.487z"
                                />
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M21 21H3V3h10"
                                />
                            </svg>
                        </button>
                        <button
                            onClick={onOpenSettings}
                            className="p-2 hover:bg-gray-300 rounded"
                            title="Settings"
                            aria-label="Settings"
                            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                        >
                            <svg
                                className="w-5 h-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                                />
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-notes-border" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <SearchBar value={searchQuery} onChange={setSearchQuery} />
            </div>

            {/* Notes List */}
            <div
                className="flex-1 overflow-auto"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                {Object.entries(groupedNotes).length === 0 ? (
                    <div className="p-4 text-center text-gray-500">
                        {searchQuery ? 'No notes found' : 'No notes yet'}
                    </div>
                ) : (
                    Object.entries(groupedNotes).map(([folder, folderNotes]) => (
                        <div key={folder} className="mb-4">
                            <div className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase">
                                {folder}
                            </div>
                            {folderNotes.map((note) => (
                                <NoteItem
                                    key={note.id}
                                    note={note}
                                    isSelected={note.id === currentNoteId}
                                    onSelect={() => onSelectNote(note.id)}
                                    onDelete={() => onDeleteNote(note.id)}
                                />
                            ))}
                        </div>
                    ))
                )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-notes-border text-xs text-gray-500 text-center">
                {notes.length} {notes.length === 1 ? 'note' : 'notes'}
            </div>
        </div>
    )
}

export default Sidebar
