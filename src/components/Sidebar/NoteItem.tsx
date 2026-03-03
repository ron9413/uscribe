import { NoteMetadata } from '../../types'

interface NoteItemProps {
    note: NoteMetadata
    isSelected: boolean
    onSelect: () => void
    onDelete: () => void
}

function NoteItem({ note, isSelected, onSelect, onDelete }: NoteItemProps) {
    const formatDate = (dateString: string) => {
        const date = new Date(dateString)
        const now = new Date()
        const diff = now.getTime() - date.getTime()
        const days = Math.floor(diff / 86400000)

        if (days === 0) {
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit'
            })
        } else if (days === 1) {
            return "Yesterday"
        } else if (days < 7) {
            return date.toLocaleDateString('en-US', { weekday: 'short' })
        } else {
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            })
        }
    }

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (confirm(`Delete "${note.title}"?`)) {
            onDelete()
        }
    }

    return (
        <div
            onClick={onSelect}
            className={`group px-4 py-3 cursor-pointer border-l-4 transition-colors ${
                isSelected
                    ? 'bg-yellow-100 border-yellow-400'
                    : 'border-transparent hover:bg-gray-200'
            }`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
            <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                    <h3 className=" font-medium text-notes-text truncate">
                        {note.title}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1">
                        {formatDate(note.updatedAt)}
                    </p>
                </div>
                <button
                    onClick={handleDelete}
                    onMouseDown={(e) => e.stopPropagation() }
                    className="ml-2 p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    title="Delete note"
                    type="button"
                >
                    <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                    </svg>
                </button>
            </div>
            {note.tags && note.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {note.tags.slice(0, 3).map((tag) => (
                        <span
                            key={tag}
                            className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}
        </div>
    )
}

export default NoteItem
