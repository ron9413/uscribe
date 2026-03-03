import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary'
import { EditorState } from 'lexical'
import { Note, AIConfig } from '../../types'
import AutoCompletePlugin from './plugins/AutoCompletePlugin'
import AutoCompleteShortcutPlugin from './plugins/AutoCompleteShortcutPlugin'
import TextRevisionPlugin from './plugins/TextRevisionPlugin'
import TitleBar from './TitleBar'

// Strip pending revision/autocomplete highlights from saved content so that reopening
// the app never shows orphaned temporary UI state.
// Red-highlighted nodes (original, text) have their style cleared.
// Green-highlighted nodes (suggested text) and their preceding linebreak are removed.
// Gray autocomplete pending nodes are removed.
function sanitizeRevisionHighlights(contentJson: string): string {
    try {
        const state = JSON.parse(contentJson)

        function processNode(node: any): any[] {
            if (!node) return [node]

            if (node.type === 'text') {
                if (node.style?.includes('#dcfce7')) return []
                if (node.style?.includes('#fee2e2')) return { ...node, style: '' }
                if (node.style?.includes('--autocomplete-pending: 1')) return []
                return [node]
            }

            if (Array.isArray(node.children)) {
                const newChildren: any[] = []
                for (const child of node.children) {
                    const processed = processNode(child)
                    if (processed.length === 0) {
                        // Green node removed - also drop the linebreak that preceded it
                        if (newChildren.length > 0 && newChildren[newChildren.length - 1].type === 'linebreak') {
                            newChildren.pop()
                        }
                    } else {
                        newChildren.push(...processed)
                    }
                }
                return [{ ...node, children: newChildren }]
            }

            return [node]
        }

        const [processedRoot] = processNode(state.root)
        return JSON.stringify({ ...state, root: processedRoot })
    } catch {
        return contentJson
    }
}

interface EditorProps {
    note: Note
    config: AIConfig | null
    onUpdate: (updates: Partial<Note>) => void
    onToggleAutoComplete?: () => void
}

function Editor({ note, config, onUpdate, onToggleAutoComplete }: EditorProps) {
    const initialConfig = {
        namespace: "AINotesEditor",
        theme: {
            paragraph: "editor-paragraph",
            text: {
                bold: "editor-text-bold",
                italic: "editor-text-italic",
                underline: "editor-text-underline",
            },
        },
        onError: (error: Error) => {
            console.error("Lexical error:", error)
        },
        editorState: note.content || undefined,
    }

    const handleContentChange = (editorState: EditorState) => {
        const raw = JSON.stringify(editorState.toJSON())
        const json = sanitizeRevisionHighlights(raw)
        if (json !== note.content) {
            onUpdate({ content: json })
        }
    }

    const handleTitleChange = (title: string) => {
        onUpdate({ title })
    }

    return (
        <div className="flex-1 flex flex-col bg-white min-h-0">
            <TitleBar
                title={note.title}
                onTitleChange={handleTitleChange}
                updatedAt={note.updatedAt}
            />

            <div className="flex-1 overflow-auto px-16 py-8">
                <LexicalComposer key={note.id} initialConfig={initialConfig}>
                    <div className="editor-container relative">
                        <RichTextPlugin
                            contentEditable={
                                <ContentEditable className="editor-content outline-none min-h-[200px] text-lg leading-relaxed text-notes-text" />
                            }
                            placeholder={
                                <div className="editor-placeholder absolute top-0 left-0 text-gray-400 text-lg pointer-events-none">
                                    Start typing...
                                </div>
                            }
                            ErrorBoundary={LexicalErrorBoundary}
                        />
                        <OnChangePlugin onChange={handleContentChange} />
                        <HistoryPlugin />

                        {config && config.autoCompleteEnabled && config.activeProvider && (
                            <AutoCompletePlugin
                                providerName={config.activeProvider}
                                delay={config.autoCompleteDelay}
                                note={note}
                            />
                        )}
                        {onToggleAutoComplete && (
                            <AutoCompleteShortcutPlugin onToggleAutoComplete={onToggleAutoComplete} />
                        )}
                        <TextRevisionPlugin
                            providerName={config?.activeProvider ?? ''}
                            customShortcuts={config?.customRevisionShortcuts ?? []}
                        />
                    </div>
                </LexicalComposer>
            </div>
        </div>
    )
}

export default Editor
