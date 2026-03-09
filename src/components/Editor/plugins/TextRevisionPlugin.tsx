import { useEffect, useState, useCallback, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
    $getSelection,
    $createRangeSelection,
    $setSelection,
    $isRangeSelection,
    $getNodeByKey,
    $getRoot,
    $isElementNode,
    $createLineBreakNode,
    COMMAND_PRIORITY_LOW,
    LexicalNode,
} from 'lexical'
import { diffChars } from 'diff'
import { useTextRevision } from '../../../hooks/useTextRevision'
import { CustomRevisionShortcut, RevisionAction } from '../../../types'
import RevisionMenu from '../RevisionMenu'
import { matchesAccelerator } from '../../../utils/shortcutUtils'
import {
    $createInlineRevisionNode,
    $isInlineRevisionNode,
    ACCEPT_INLINE_REVISION_COMMAND,
    REJECT_INLINE_REVISION_COMMAND,
} from '../nodes/InlineRevisionNode'

const PROVIDER_WARNING = 'Please set an AI provider in Settings to use text revision.'

interface TextRevisionPluginProps {
    providerName: string
    customShortcuts: CustomRevisionShortcut[]
}

interface StoredSelectionRange {
    startOffset: number
    endOffset: number
    startKey: string
    endKey: string
}

interface SelectionSnapshot {
    range: StoredSelectionRange | null
    text: string
    prefix: string
    suffix: string
}

interface InlineRevisionRange {
    startOffset: number
    endOffset: number
    startKey: string
    endKey: string
}

function getDomSelectionContext(
    editorRoot: HTMLElement | null,
): { prefix: string; suffix: string } | null {
    if (!editorRoot) return null
    const domSelection = window.getSelection()
    if (!domSelection || domSelection.rangeCount === 0) return null

    const domRange = domSelection.getRangeAt(0)
    const commonAncestor = domRange.commonAncestorContainer
    const isInsideEditor =
        commonAncestor === editorRoot || editorRoot.contains(commonAncestor)
    if (!isInsideEditor) return null

    try {
        const prefixRange = document.createRange()
        prefixRange.selectNodeContents(editorRoot)
        prefixRange.setEnd(domRange.startContainer, domRange.startOffset)

        const suffixRange = document.createRange()
        suffixRange.selectNodeContents(editorRoot)
        suffixRange.setStart(domRange.endContainer, domRange.endOffset)
 
        return {
            prefix: prefixRange.toString(),
            suffix: suffixRange.toString(),
        }
    } catch {
        return null
    }
}

function TextRevisionPlugin({ providerName, customShortcuts }: TextRevisionPluginProps) {
    const [editor] = useLexicalComposerContext()
    const [selectedText, setSelectedText] = useState('')
    const [showMenu, setShowMenu] = useState(false)
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
    const [menuMode, setMenuMode] = useState<'menu' | 'custom'>('menu')
    const [showProviderWarning, setShowProviderWarning] = useState(false)
    const [hasInlineRevisionNode, setHasInlineRevisionNode] = useState(false)
    const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const activeRevisionNodeKeyRef = useRef<string | null>(null)
    const selectionSnapshotRef = useRef<SelectionSnapshot>({
        range: null,
        text: '',
        prefix: '',
        suffix: '',
    })

    const {
        reviseText,
        isRevising,
        revisionResult,
        acceptRevision,
        rejectRevision,
    } = useTextRevision({ providerName })

    // Store selection range helper
    const getSelectionRange = useCallback(() => {
        let selectionRange: StoredSelectionRange | null = null
        editor.getEditorState().read(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
                const isBackward = selection.isBackward()
                const startPoint = isBackward ? selection.focus : selection.anchor
                const endPoint = isBackward ? selection.anchor : selection.focus
                selectionRange = {
                    startOffset: startPoint.offset,
                    endOffset: endPoint.offset,
                    startKey: startPoint.key,
                    endKey: endPoint.key,
                }
            }
        })
        return selectionRange
    }, [editor])

    const showWarning = useCallback(() => {
        if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current)
        setShowProviderWarning(true)
        warningTimeoutRef.current = setTimeout(() => {
            setShowProviderWarning(false)
            warningTimeoutRef.current = null
        }, 5000)
    }, [])

    const captureSelectionSnapshot = useCallback(() => {
        const range = getSelectionRange()
        let text = ''

        editor.getEditorState().read(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
                text = selection.getTextContent()
            }
        })

        const editorRoot = editor.getRootElement()
        const selectionContext = getDomSelectionContext(editorRoot)

        selectionSnapshotRef.current = {
            range: range || selectionSnapshotRef.current.range,
            text: text || selectionSnapshotRef.current.text,
            prefix: selectionContext?.prefix ?? selectionSnapshotRef.current.prefix,
            suffix: selectionContext?.suffix ?? selectionSnapshotRef.current.suffix,
        }
    }, [editor, getSelectionRange])

    const insertInlineRevisionNodeAtRange = useCallback((
        selectionRange: StoredSelectionRange,
        originalText: string,
        revisedText: string,
        isLoading: boolean,
    ) => {
        editor.update(() => {
            const selection = $createRangeSelection()
            selection.anchor.set(selectionRange.startKey, selectionRange.startOffset, 'text')
            selection.focus.set(selectionRange.endKey, selectionRange.endOffset, 'text')
            $setSelection(selection)
            const inlineNode = $createInlineRevisionNode(
                originalText,
                revisedText,
                diffChars(originalText, revisedText),
                selectionRange,
                isLoading,
            )
            const collapsedAfterSelection = $createRangeSelection()
            collapsedAfterSelection.anchor.set(selectionRange.endKey, selectionRange.endOffset, 'text')
            collapsedAfterSelection.focus.set(selectionRange.endKey, selectionRange.endOffset, 'text')
            $setSelection(collapsedAfterSelection)
            collapsedAfterSelection.insertNodes([$createLineBreakNode(), inlineNode])
            activeRevisionNodeKeyRef.current = inlineNode.getKey()
        }, { tag: 'historic' })
        setHasInlineRevisionNode(true)
    }, [editor])

    const updateInlineRevisionNode = useCallback((
        nodeKey: string,
        revisedText: string,
        isLoading: boolean,
    ) => {
        editor.update(() => {
            const node = $getNodeByKey(nodeKey)
            if (!$isInlineRevisionNode(node)) return
            node.setRevision(revisedText, diffChars(node.getOriginalText(), revisedText))
            node.setLoading(isLoading)
        }, { tag: 'historic' })
    }, [editor])

    const findFirstInlineRevisionNode = useCallback((nodes: LexicalNode[]): string | null => {
        const stack = [...nodes]
        while (stack.length > 0) {
            const node = stack.shift()!
            if ($isInlineRevisionNode(node)) {
                return node.getKey()
            }
            if ($isElementNode(node)) {
                stack.push(...node.getChildren())
            }
        }
        return null
    }, [])

    const removeInlineRevisionNode = useCallback((nodeKey: string) => {
        editor.update(() => {
            const node = $getNodeByKey(nodeKey)
            if (!$isInlineRevisionNode(node)) return
            const prevSibling = node.getPreviousSibling()
            node.remove()
            if (prevSibling && prevSibling.getType() === 'linebreak') {
                prevSibling.remove()
            }
        }, { tag: 'historic' })
    }, [editor])

    const applyAcceptedRevision = useCallback((nodeKey: string, acceptedText: string) => {
        editor.update(() => {
            const node = $getNodeByKey(nodeKey)
            if (!$isInlineRevisionNode(node)) return

            const range = node.getRange() as InlineRevisionRange
            const selection = $createRangeSelection()
            selection.anchor.set(range.startKey, range.startOffset, 'text')
            selection.focus.set(range.endKey, range.endOffset, 'text')
            $setSelection(selection)
            selection.insertText(acceptedText)

            const previousSibling = node.getPreviousSibling()
            node.remove()
            if (previousSibling && previousSibling.getType() === 'linebreak') {
                previousSibling.remove()
            }
        }, { tag: 'historic-push' })
    }, [editor])

    const clearActiveSelection = useCallback(() => {
        editor.update(() => {
            $setSelection(null)
        })
        
        const domSelection = window.getSelection()
        if (domSelection) {
            domSelection.removeAllRanges()
        }

        setSelectedText('')
        setShowMenu(false)
        selectionSnapshotRef.current = {
            range: null,
            text: '',
            prefix: '',
            suffix: '',
        }
    }, [editor])

    const handleRevision = useCallback(async (action: RevisionAction, customPrompt?: string) => {
        if (isRevising) return

        rejectRevision()
        if (activeRevisionNodeKeyRef.current) {
            editor.dispatchCommand(REJECT_INLINE_REVISION_COMMAND, {
                nodeKey: activeRevisionNodeKeyRef.current
            })
        }
        const textToRevise = selectedText || selectionSnapshotRef.current.text
        if (!textToRevise.trim()) return
        if (!providerName?.trim()) {
            setShowMenu(false)
            showWarning()
            return
        }

        setShowMenu(false)

        const liveSelectionRange = getSelectionRange()
        const selectionRange = liveSelectionRange || selectionSnapshotRef.current.range
        if (!selectionRange) return

        insertInlineRevisionNodeAtRange(selectionRange, textToRevise, '', true)

        const hookSelectionRange = selectionRange
            ? {
                anchorOffset: selectionRange.startOffset,
                focusOffset: selectionRange.endOffset,
                anchorKey: selectionRange.startKey,
                focusKey: selectionRange.endKey,
              }
            : undefined
        const selectionContext =
            getDomSelectionContext(editor.getRootElement()) || {
                prefix: selectionSnapshotRef.current.prefix,
                suffix: selectionSnapshotRef.current.suffix,
            }

        try {
            const finalRevision = await reviseText(
                textToRevise,
                action,
                customPrompt,
                hookSelectionRange,
                selectionContext,
            )
            if (activeRevisionNodeKeyRef.current && finalRevision !== null) {
                updateInlineRevisionNode(activeRevisionNodeKeyRef.current, finalRevision, false)
            }
        } catch {
            if (activeRevisionNodeKeyRef.current) {
                editor.dispatchCommand(REJECT_INLINE_REVISION_COMMAND, {
                    nodeKey: activeRevisionNodeKeyRef.current
                })
            }
        }
    }, [
        selectedText,
        providerName,
        getSelectionRange,
        reviseText,
        rejectRevision,
        showWarning,
        editor,
        isRevising,
        insertInlineRevisionNodeAtRange,
        updateInlineRevisionNode,
    ])

    // Keep inline revision node tracking in sync, including persisted content reloads.
    useEffect(() => {
        editor.getEditorState().read(() => {
            const nodeKey = findFirstInlineRevisionNode($getRoot().getChildren())
            activeRevisionNodeKeyRef.current = nodeKey
            setHasInlineRevisionNode(Boolean(nodeKey))
        })

        return editor.registerUpdateListener(({ editorState }) => {
            editorState.read(() => {
                const nodeKey = findFirstInlineRevisionNode($getRoot().getChildren())
                activeRevisionNodeKeyRef.current = nodeKey
                setHasInlineRevisionNode(Boolean(nodeKey))
            })
        })
    }, [editor, findFirstInlineRevisionNode])

    // Stream updated suggestion text into the persisted inline revision node.
    useEffect(() => {
        if (!revisionResult || !activeRevisionNodeKeyRef.current) return
        updateInlineRevisionNode(activeRevisionNodeKeyRef.current, revisionResult.revised, isRevising)
    }, [revisionResult, isRevising, updateInlineRevisionNode])

    // Lock editing while a pending inline revision node is present
    useEffect(() => {
        editor.setEditable(!hasInlineRevisionNode)
        return () => editor.setEditable(true)
    }, [editor, hasInlineRevisionNode])

    // Clear warning timeout on unmount
    useEffect(() => {
        return () => {
            if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current)
        }
    }, [])

    // Clear selection when the app goes to background/inactive.
    useEffect(() => {
        const handleAppInactive = () => {
            clearActiveSelection()
        }

        const handleVisibilityChange = () => {
            if (document.hidden) {
                clearActiveSelection()
            }
        }

        window.addEventListener('blur', handleAppInactive)
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            window.removeEventListener('blur', handleAppInactive)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [clearActiveSelection])

    // Handle accept/reject from the DecoratorNode UI.
    useEffect(() => {
        const unregisterAccept = editor.registerCommand(
            ACCEPT_INLINE_REVISION_COMMAND,
            ({ nodeKey, editedText }) => {
                let fallbackRevisedText = editedText ?? ''
                editor.getEditorState().read(() => {
                    const node = $getNodeByKey(nodeKey)
                    if ($isInlineRevisionNode(node)) {
                        fallbackRevisedText = editedText ?? node.getRevisedText()
                    }
                })
                applyAcceptedRevision(nodeKey, fallbackRevisedText)
                acceptRevision(editedText)
                if (activeRevisionNodeKeyRef.current === nodeKey) {
                    activeRevisionNodeKeyRef.current = null
                }
                setHasInlineRevisionNode(false)
                return true
            },
            COMMAND_PRIORITY_LOW,
        )

        const unregisterReject = editor.registerCommand(
            REJECT_INLINE_REVISION_COMMAND,
            ({ nodeKey }) => {
                removeInlineRevisionNode(nodeKey)
                rejectRevision()
                if (activeRevisionNodeKeyRef.current === nodeKey) {
                    activeRevisionNodeKeyRef.current = null
                }
                setHasInlineRevisionNode(false)
                return true
            },
            COMMAND_PRIORITY_LOW,
        )

        return () => {
            unregisterAccept()
            unregisterReject()
        }
    }, [editor, acceptRevision, rejectRevision, applyAcceptedRevision, removeInlineRevisionNode])

    // Track text selection
    useEffect(() => {
        const unregister = editor.registerUpdateListener(({ editorState }) => {
            editorState.read(() => {
                const selection = $getSelection()
                if ($isRangeSelection(selection) && !selection.isCollapsed()) {
                    const text = selection.getTextContent()
                    setSelectedText(text)
                    selectionSnapshotRef.current = {
                        ...selectionSnapshotRef.current,
                        text,
                        range: getSelectionRange(),
                    }
                } else {
                    if (!showMenu) {
                        setSelectedText('')
                    }
                }
            })
        })

        return unregister
    }, [editor, showMenu, getSelectionRange])

    // Listen for global shortcuts from Electron
    useEffect(() => {
        const handleShortcut = (event: Event) => {
            const customEvent = event as CustomEvent
            const { type, payload } = customEvent.detail as {
                type: string
                payload?: RevisionAction | { action?: RevisionAction; customPrompt?: string }
            }

            const payloadAction =
                typeof payload === 'string' ? payload : payload?.action
            const payloadPrompt =
                typeof payload === 'string' ? undefined : payload?.customPrompt

            if (!providerName?.trim()) {
                if (type === 'revision' && selectedText) {
                    showWarning()
                }
                return
            }

            if (type === 'revision' && selectedText) {
                if (payloadAction === 'custom' && payloadPrompt) {
                    handleRevision('custom', payloadPrompt)
                    return
                }

                if (payloadAction === 'custom') {
                    captureSelectionSnapshot()
                    setMenuMode('custom')
                    setShowMenu(true)
                    const selection = window.getSelection()
                    if (selection && selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0)
                        const rect = range.getBoundingClientRect()
                        setMenuPosition({ x: rect.left, y: rect.bottom + 5 })
                    }
                    return
                }
                if (payloadAction) {
                    handleRevision(payloadAction)
                }
            }
        }
    
        window.addEventListener('electron-shortcut', handleShortcut)
        return () => window.removeEventListener('electron-shortcut', handleShortcut)
    }, [selectedText, providerName, handleRevision, showWarning, captureSelectionSnapshot])

    // Listen for local keyboard shortcuts (Quick Edit and local custom shortcuts)
    useEffect(() => {
        const editorElement = editor.getRootElement()
        if (!editorElement) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (matchesAccelerator(event, 'CommandOrControl+Shift+2')) {
                event.preventDefault()
                event.stopPropagation()

                if (!selectedText) return

                if (!providerName?.trim()) {
                    showWarning()
                    return
                }

                // Open custom prompt dialog
                captureSelectionSnapshot()
                setMenuMode('custom')
                setShowMenu(true)
                // Get cursor position for menu
                const selection = window.getSelection()
                if (selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0)
                    const rect = range.getBoundingClientRect()
                    setMenuPosition({ x: rect.left, y: rect.bottom + 5 })
                }
                return
            }

            for (const shortcut of customShortcuts) {
                const scope = shortcut.scope === 'global' ? 'global' : 'local'
                if (scope !== 'local') continue
                if (!shortcut.prompt?.trim() || !shortcut.accelerator?.trim()) continue
                if (!matchesAccelerator(event, shortcut.accelerator)) continue

                event.preventDefault()
                event.stopPropagation()

                if (!selectedText) return
                if (!providerName?.trim()) {
                    showWarning()
                    return
                }

                handleRevision('custom', shortcut.prompt)
                return
            }
        }

        // Use capture phase to catch the event before Lexical processes it
        editorElement.addEventListener('keydown', handleKeyDown, true)
        return () => editorElement.removeEventListener('keydown', handleKeyDown, true)
    }, [editor, selectedText, providerName, showWarning, captureSelectionSnapshot, customShortcuts, handleRevision])

    // Add context menu support
    useEffect(() => {
        const editorElement = editor.getRootElement()
        if (!editorElement) return

        const handleContextMenu = (event: MouseEvent) => {
            editor.getEditorState().read(() => {
                const selection = $getSelection()
                if ($isRangeSelection(selection) && !selection.isCollapsed()) {
                    // Prevent default browser context menu
                    event.preventDefault()

                    // Show our revision menu at cursor position (default to menu mode)
                    captureSelectionSnapshot()
                    setMenuMode('menu')
                    setMenuPosition({ x: event.clientX, y: event.clientY })
                    setShowMenu(true)
                }
            })
        }

        editorElement.addEventListener('contextmenu', handleContextMenu)
        return () => editorElement.removeEventListener('contextmenu', handleContextMenu)
    }, [editor, captureSelectionSnapshot])

    return (
        <>
            {showMenu && (
                <RevisionMenu
                    position={menuPosition}
                    onSelect={handleRevision}
                    onClose={() => {
                        setShowMenu(false)
                    }}
                    initialMode={menuMode}
                    customShortcuts={customShortcuts}
                />
            )}

            {showProviderWarning && (
                <div
                    className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg shadow-lg flex items-center gap-3 max-w-md"
                    role="alert"
                >
                    <span className="text-amber-800 text-sm">{PROVIDER_WARNING}</span>
                    <button
                        type="button"
                        onClick={() => {
                            setShowProviderWarning(false)
                            if (warningTimeoutRef.current) {
                                clearTimeout(warningTimeoutRef.current)
                                warningTimeoutRef.current = null
                            }
                        }}
                        className="text-amber-600 hover:text-amber-800 shrink-0 text-sm font-medium"
                        aria-label="Dismiss"
                    >
                        Dismiss
                    </button>
                </div>
            )}
        </>
    )
}

export default TextRevisionPlugin
