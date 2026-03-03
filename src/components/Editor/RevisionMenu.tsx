import { useState, useEffect, useRef } from "react"
import { CustomRevisionShortcut, RevisionAction } from '../../types'
import { acceleratorToDisplay } from '../../utils/shortcutUtils'

interface RevisionMenuProps {
    position: { x: number; y: number }
    onSelect: (action: RevisionAction, customPrompt?: string) => void
    onClose: () => void
    initialMode?: 'menu' | 'custom'
    onCustomOpen?: () => void
    customShortcuts?: CustomRevisionShortcut[]
}

function RevisionMenu({
    position,
    onSelect,
    onClose,
    initialMode = 'menu',
    onCustomOpen,
    customShortcuts = [],
}: RevisionMenuProps) {
    const [showCustom, setShowCustom] = useState(initialMode === 'custom')
    const [customPrompt, setCustomPrompt] = useState('')
    const menuRef = useRef<HTMLDivElement | null>(null)

    // Update showCustom when initialMode changes
    useEffect(() => {
        setShowCustom(initialMode === 'custom')
    }, [initialMode])

    useEffect(() => {
        if (showCustom) {
            onCustomOpen?.()
        }
    }, [showCustom, onCustomOpen])

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (!menuRef.current) return
            if (!menuRef.current.contains(event.target as Node)) {
                onClose()
            }
        }

        document.addEventListener('mousedown', handleOutsideClick)
        return () => document.removeEventListener('mousedown', handleOutsideClick)
    }, [onClose])

    const actions: Array<{
        id: string
        action: RevisionAction
        label: string
        shortcut: string
        prompt?: string
    }> = [
        { id: 'revise', action: 'revise', label: 'Revise Text', shortcut: '⌘⇧1' },
        { id: 'custom', action: 'custom', label: 'Quick Edit', shortcut: '⌘⇧2' },
        ...customShortcuts.map(item => ({
            id: item.id,
            action: 'custom' as const,
            label: item.name || 'Custom Shortcut',
            shortcut: acceleratorToDisplay(item.accelerator),
            prompt: item.prompt,
        }))
    ]

    const handleCustomSubmit = () => {
        if (customPrompt.trim()) {
            onSelect('custom', customPrompt)
            setShowCustom(false)
            setCustomPrompt('')
        }
    }

    return (
        <div
            ref={menuRef}
            className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-2 min-w-[220px]"
            style={{ left: position.x, top: position.y }}
        >
            {!showCustom ? (
                <>
                    {actions.map(({ id, action, label, shortcut, prompt }) => (
                        <button
                            key={id}
                            className="w-full px-4 py-2 text-left hover:bg-gray-100 flex justify-between items-center"
                            onClick={() => {
                                if (action === 'custom' && prompt) {
                                    onSelect('custom', prompt)
                                    return
                                }
                                if (action === 'custom') {
                                    setShowCustom(true)
                                    return
                                }
                                onSelect(action)
                            }}
                        >
                            <span>{label}</span>
                            {shortcut && (
                                <span className="text-xs text-gray-400">{shortcut}</span>
                            )}
                        </button>
                    ))}
                    <hr className="my-1 border-gray-200" />
                    <button
                        className="w-full px-4 py-2 text-left hover:bg-gray-100 text-gray-500"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                </>
            ) : (
                <div className="px-4 py-2">
                    <input
                        type="text"
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                e.stopPropagation()
                                handleCustomSubmit()
                            } else if (e.key === 'Escape') {
                                e.preventDefault()
                                e.stopPropagation()
                                setCustomPrompt('')
                                onClose()
                            }
                        }}
                        placeholder="Edit selected text"
                        className="w-full px-2 py-1 border border-gray-300 rounded outline-none focus:border-blue-500"
                    />
                    <div className="flex gap-2 mt-2">
                        <button
                            className="flex-1 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                            onClick={handleCustomSubmit}
                        >
                            Apply
                        </button>
                        <button
                            className="flex-1 px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
                            onClick={() => {
                                setCustomPrompt('')
                                onClose()
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default RevisionMenu
