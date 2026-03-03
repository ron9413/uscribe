import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

interface AutoCompleteShortcutPluginProps {
    onToggleAutoComplete: () => void
}

/**
 * Listens for Shift+Tab in the editor to toggle autocomplete on/off (local shortcut).
 */
function AutoCompleteShortcutPlugin({ onToggleAutoComplete }: AutoCompleteShortcutPluginProps) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        const editorElement = editor.getRootElement()
        if (!editorElement) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Tab' && event.shiftKey) {
                event.preventDefault()
                event.stopPropagation()
                onToggleAutoComplete()
            }
        }

        editorElement.addEventListener('keydown', handleKeyDown, true)
        return () => editorElement.removeEventListener('keydown', handleKeyDown, true)
    }, [editor, onToggleAutoComplete])

    return null
}

export default AutoCompleteShortcutPlugin
