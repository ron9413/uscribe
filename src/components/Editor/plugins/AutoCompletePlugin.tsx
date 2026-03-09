import { useCallback, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
    $getSelection,
    $createLineBreakNode,
    $createTextNode,
    $getNodeByKey,
    $isRangeSelection,
    $getRoot,
    SELECTION_CHANGE_COMMAND,
    COMMAND_PRIORITY_LOW,
} from 'lexical'
import { useAutoComplete } from '../../../hooks/useAutoComplete'
import { Note } from '../../../types'
    
interface AutoCompletePluginProps {
    providerName: string
    delay: number
    note: Note
}

interface AutoCompleteContext {
    fullText: string
    cursorPosition: number
}

interface InsertionPoint {
    key: string
    offset: number
    type: 'text' | 'element'
}

const PENDING_AUTOCOMPLETE_STYLE = 'color: #9ca3af; opacity: 0.6; --autocomplete-pending: 1;'
const PENDING_AUTOCOMPLETE_MARKER = '--autocomplete-pending: 1'

function isPendingAutocompleteNodeStyle(style: string): boolean {
    return style.includes(PENDING_AUTOCOMPLETE_MARKER)
}

function hasInlineRevisionNode(): boolean {
    const root = $getRoot()
    const stack = [...root.getChildren()]

    while (stack.length > 0) {
        const node = stack.shift()!
        if (node.getType() === 'inline-revision') {
            return true
        }
        if ('getChildren' in node && typeof node.getChildren === 'function') {
            stack.push(...node.getChildren())
        }
    }

    return false
}

function AutoCompletePlugin({ providerName, delay, note }: AutoCompletePluginProps) {
    const [editor] = useLexicalComposerContext()
    const [contextData, setContextData] = useState<AutoCompleteContext>({
        fullText: '',
        cursorPosition: 0
    })
    const [isInlineRevisionActive, setIsInlineRevisionActive] = useState(false)
    const [isAutocompleteSupressed, setIsAutocompleteSuppressed] = useState(false)
    const [hasEditedSinceMount, setHasEditedSinceMount] = useState(false)
    const pendingNodeKeysRef = useRef<string[]>([])
    const activeSuggestionRef = useRef('')
    const insertionPointRef = useRef<InsertionPoint | null>(null)
    const previousInlineRevisionActiveRef = useRef(false)
    const suppressedContentRef = useRef<string | null>(null)
    const initialContentRef = useRef<string | null>(null)

    const clearPendingSuggestionNodes = useCallback(() => {
        const pendingKeys = pendingNodeKeysRef.current
        if (pendingKeys.length === 0) return

        editor.update(() => {
            pendingKeys.forEach((key) => {
                const node = $getNodeByKey(key)
                if (node) {
                    node.remove()
                }
            })
        }, { tag: 'historic' })

        pendingNodeKeysRef.current = []
    }, [editor])

    const renderPendingSuggestion = useCallback((suggestionText: string) => {
        editor.update(() => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
                return
            }
           
            const anchorKey = selection.anchor.key
            const anchorOffset = selection.anchor.offset
            const anchorType = selection.anchor.type
            insertionPointRef.current = {
                key: anchorKey,
                offset: anchorOffset,
                type: anchorType,
            }

            const lines = suggestionText.split('\n')
            const insertedKeys: string[] = []
            const nodesToInsert = lines.flatMap((line, index) => {
                const lineNode = $createTextNode(line)
                lineNode.setStyle(PENDING_AUTOCOMPLETE_STYLE)
                lineNode.setMode('token')
                insertedKeys.push(lineNode.getKey())

                if (index === lines.length - 1) {
                    return [lineNode]
                }

                return [lineNode, $createLineBreakNode()]
            })

            if (nodesToInsert.length === 0) return

            selection.insertNodes(nodesToInsert)
            pendingNodeKeysRef.current = insertedKeys

            // Keep the caret at original position so pending text behaves like ghost text.
            const anchorNode = $getNodeByKey(anchorKey)
            if (anchorNode) {
                const restoredSelection = $getSelection()
                if ($isRangeSelection(restoredSelection)) {
                    restoredSelection.anchor.set(anchorKey, anchorOffset, anchorType)
                    restoredSelection.focus.set(anchorKey, anchorOffset, anchorType)
                }
            }
        }, { tag: 'historic' })
     }, [editor])

     const syncContextFromEditor = useCallback(() => {
        editor.getEditorState().read(() => {
            const inlineRevisionActive = hasInlineRevisionNode()
            setIsInlineRevisionActive(inlineRevisionActive)
            const selection = $getSelection()
            const root = $getRoot()
            const nodes = root.getAllTextNodes()

            let allText = ''
            for (const node of nodes) {
                if (!isPendingAutocompleteNodeStyle(node.getStyle())) {
                    allText += node.getTextContent()
                }
            }
            if (initialContentRef.current === null) {
                initialContentRef.current = allText
            } else if (!hasEditedSinceMount && allText !== initialContentRef.current) {
                setHasEditedSinceMount(true)
            }

            const wasInlineRevisionActive = previousInlineRevisionActiveRef.current
            if (wasInlineRevisionActive && !inlineRevisionActive) {
                suppressedContentRef.current = allText
                setIsAutocompleteSuppressed(true)
            }
            previousInlineRevisionActiveRef.current = inlineRevisionActive

            let shouldSuppressAutocomplete = isAutocompleteSupressed
            if (shouldSuppressAutocomplete) {
                if (suppressedContentRef.current !== null && allText !== suppressedContentRef.current) {
                    shouldSuppressAutocomplete = false
                    suppressedContentRef.current = null
                    setIsAutocompleteSuppressed(false)
                } else {
                    return
                }
            }

            if (inlineRevisionActive) {
                return
            }

            if ($isRangeSelection(selection) && selection.isCollapsed()) {
                let cursorPosition = 0
                const anchorNode = selection.anchor.getNode()
                const anchorOffset = selection.anchor.offset
                let foundCursor = false

                for (const node of nodes) {
                    const textContent = node.getTextContent()
                    const isPending = isPendingAutocompleteNodeStyle(node.getStyle())
                    if (node.is(anchorNode)) {
                        if (!isPending) {
                            cursorPosition += Math.min(anchorOffset, textContent.length)
                        }
                        foundCursor = true
                        break
                    }
                    if (!isPending) {
                        cursorPosition += textContent.length
                    }
                }

                if (!foundCursor) {
                    cursorPosition = Math.min(anchorOffset, allText.length)
                }

                setContextData((prev) => {
                    if (prev.fullText === allText && prev.cursorPosition === cursorPosition) {
                        return prev
                    }
                    return { fullText: allText, cursorPosition }
                })
            }
        })
    }, [editor, isAutocompleteSupressed, hasEditedSinceMount])

    // Extract context from editor and calculate cursor position
    useEffect(() => {
        const unregisterUpdate = editor.registerUpdateListener(() => {
            syncContextFromEditor()
        })

        const unregisterSelection = editor.registerCommand(
            SELECTION_CHANGE_COMMAND,
            () => {
                syncContextFromEditor()
                return false
            },
            COMMAND_PRIORITY_LOW
        )

        syncContextFromEditor()

        return () => {
            unregisterUpdate()
            unregisterSelection()
        }
    }, [editor, note.id, syncContextFromEditor])

    const handleAccept = (suggestionText: string) => {
        editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
                const insertionPoint = insertionPointRef.current
                if (insertionPoint) {
                    const anchorNode = $getNodeByKey(insertionPoint.key)
                    if (anchorNode) {
                        selection.anchor.set(insertionPoint.key, insertionPoint.offset, insertionPoint.type)
                        selection.focus.set(insertionPoint.key, insertionPoint.offset, insertionPoint.type)
                    }
                }
            }

            pendingNodeKeysRef.current.forEach((key) => {
                const node = $getNodeByKey(key)
                if (node) {
                    node.remove()
                }
            })
            pendingNodeKeysRef.current = []

            const acceptSelection = $getSelection()
            if ($isRangeSelection(acceptSelection)) {
                const lines = suggestionText.split('\n')
                const acceptedNodes = lines.flatMap((line, index) => {
                    const lineNode = $createTextNode(line)
                    if (index === lines.length - 1) {
                        return [lineNode]
                    }
                    return [lineNode, $createLineBreakNode()]
                })
                acceptSelection.insertNodes(acceptedNodes)
            }
        })
        activeSuggestionRef.current = ''
        insertionPointRef.current = null
    }

    const { suggestion, isLoading, accept, reject } = useAutoComplete(
        contextData,
        handleAccept,
        {
            providerName,
            delay,
            enabled: hasEditedSinceMount && !isInlineRevisionActive && !isAutocompleteSupressed
        }
    )

    // While inline revision is active, ensure autocomplet is fully cleared/disabled.
    useEffect(() => {
        if (!isInlineRevisionActive) return
        clearPendingSuggestionNodes()
        activeSuggestionRef.current = ''
        insertionPointRef.current = null
        reject()
    }, [isInlineRevisionActive, clearPendingSuggestionNodes, reject])

    // Immediately after inline revision accept/reject, pause autocomplete until user edits content again.
    useEffect(() => {
        if (!isAutocompleteSupressed) return
        clearPendingSuggestionNodes()
        activeSuggestionRef.current = ''
        insertionPointRef.current = null
        reject()
    }, [isAutocompleteSupressed, clearPendingSuggestionNodes, reject])

    // Keep editor content in sync with streaming suggestion text.
    useEffect(() => {
        if (!hasEditedSinceMount || isInlineRevisionActive || isAutocompleteSupressed) return
        if (suggestion === activeSuggestionRef.current) return
        clearPendingSuggestionNodes()
        activeSuggestionRef.current = suggestion
        if (suggestion) {
            renderPendingSuggestion(suggestion)
        }
    }, [suggestion, clearPendingSuggestionNodes, renderPendingSuggestion, isInlineRevisionActive, isAutocompleteSupressed, hasEditedSinceMount])

    // Handle keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!hasEditedSinceMount || isInlineRevisionActive || isAutocompleteSupressed) return
            if (suggestion) {
                if (event.key === 'Tab') {
                    event.preventDefault()
                    accept()
                } else if (event.key === 'Escape') {
                    event.preventDefault()
                    reject()
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [suggestion, accept, reject, isInlineRevisionActive, isAutocompleteSupressed, hasEditedSinceMount])

    useEffect(() => {
        return () => {
            clearPendingSuggestionNodes()
            insertionPointRef.current = null
        }
    }, [clearPendingSuggestionNodes])

    // Show loading indicator
    if (isLoading && !suggestion) {
        return (
            <div
                className="fixed bottom-4 right-4 bg-blue-500 text-white text-xs px-3 py-1 rounded shadow-lg pointer-events-none flex items-center gap-2"
                style={{ zIndex: 1000 }}
            >
                <span className="animate-pulse">•</span>
                Generating suggestion...
            </div>
        )
    }

    // Show helper hint while suggestion is pending in the editor.
    if (suggestion) {
        return (
            <div
                className="fixed bottom-4 right-4 bg-gray-800 text-white text-xs px-3 py-1 rounded shadow-lg pointer-events-none"
                style={{ zIndex: 1000 }}
            >
                Tab to accept • Esc to dismiss
            </div>
        )
    }

    return null
}

export default AutoCompletePlugin
