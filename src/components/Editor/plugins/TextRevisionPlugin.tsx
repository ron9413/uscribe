import { useEffect, useState, useCallback, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
    $getSelection,
    $createRangeSelection,
    $setSelection,
    $isRangeSelection,
    $isTextNode,
    $getNodeByKey,
    $createTextNode,
    $createLineBreakNode,
    type LexicalNode,
} from 'lexical'
import { useTextRevision } from '../../../hooks/useTextRevision'
import { CustomRevisionShortcut, RevisionAction } from '../../../types'
import RevisionMenu from '../RevisionMenu'
import { matchesAccelerator } from '../../../utils/shortcutUtils'

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
    nodeKeys: string[]
    text: string
    prefix: string
    suffix: string
    diffPosition: { x: number; y: number } | null
}

function getNodeEndPosition(
    domElement: HTMLElement,
    editorRoot: HTMLElement,
): { x: number; y: number } | null {
    const range = document.createRange()
    const walker = document.createTreeWalker(domElement, NodeFilter.SHOW_TEXT)
    let lastTextNode: Text | null = null
    let node: Node | null
    while ((node = walker.nextNode())) {
        lastTextNode = node as Text
    }

    if (lastTextNode) {
        range.setStart(lastTextNode, lastTextNode.length)
        range.setEnd(lastTextNode, lastTextNode.length)
    } else {
        range.selectNodeContents(domElement)
        range.collapse(false)
    }

    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return null
    const editorRect = editorRoot.getBoundingClientRect()
    return {
        x: rect.left - editorRect.left,
        y: rect.bottom - editorRect.top + 8,
    }
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
    const [diffPosition, setDiffPosition] = useState({ x: 0, y: 0 })
    const [showProviderWarning, setShowProviderWarning] = useState(false)
    const [highlightedNodeKeys, setHighlightedNodeKeys] = useState<string[]>([])
    const [suggestedNodeKeys, setSuggestedNodeKeys] = useState<string[]>([])
    const [storedSelectionRange, setStoredSelectionRange] = useState<StoredSelectionRange | null>(null)
    const [buttonPosition, setButtonPosition] = useState({ x: 0, y: 0 })
    const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const menuHighlightNodeKeysRef = useRef<string[]>([])
    const menuHighlightStylesRef = useRef<Map<string, string>>(new Map())
    const suggestedNodeKeysRef = useRef<string[]>([])
    const highlightedNodeKeysRef = useRef<string[]>([])
    const pendingTargetNodeKeysRef = useRef<string[]>([])
    const revisionInFlightRef = useRef(false)
    const selectionSnapshotRef = useRef<SelectionSnapshot>({
        range: null,
        nodeKeys: [],
        text: '',
        prefix: '',
        suffix: '',
        diffPosition: null,
    })

    // Keep refs in sync for clearPreviousRevisionDiff (avoids stale closure)
    suggestedNodeKeysRef.current = suggestedNodeKeys
    highlightedNodeKeysRef.current = highlightedNodeKeys

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
        let nodeKeys: string[] = []
        let text = ''

        editor.getEditorState().read(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
                nodeKeys = selection.getNodes().map(node => node.getKey())
                text = selection.getTextContent()
            }
        })

        let diffPosition: { x: number; y: number } | null = null
        const editorRoot = editor.getRootElement()
        const domSelection = window.getSelection()
        const selectionContext = getDomSelectionContext(editorRoot)
        if (domSelection && domSelection.rangeCount > 0 && editorRoot) {
            const domRange = domSelection.getRangeAt(0)
            const commonAncestor = domRange.commonAncestorContainer
            const isInsideEditor =
                commonAncestor === editorRoot || editorRoot.contains(commonAncestor)

            if (isInsideEditor) {
                const rect = domRange.getBoundingClientRect()
                const editorRect = editorRoot.getBoundingClientRect()
                diffPosition = {
                    x: rect.left - editorRect.left,
                    y: rect.bottom - editorRect.top + 8,
                }
            }
        }

        selectionSnapshotRef.current = {
            range: range || selectionSnapshotRef.current.range,
            nodeKeys: nodeKeys.length > 0 ? nodeKeys : selectionSnapshotRef.current.nodeKeys,
            text: text || selectionSnapshotRef.current.text,
            prefix: selectionContext?.prefix ?? selectionSnapshotRef.current.prefix,
            suffix: selectionContext?.suffix ?? selectionSnapshotRef.current.suffix,
            diffPosition: diffPosition || selectionSnapshotRef.current.diffPosition,
        }
    }, [editor, getSelectionRange])

    const clearMenuSelectionHighlight = useCallback(() => {
        const highlightedKeys = menuHighlightNodeKeysRef.current
        if (highlightedKeys.length === 0) return

        const previousStyles = menuHighlightStylesRef.current
        editor.update(() => {
            highlightedKeys.forEach(key => {
                const node = $getNodeByKey(key)
                if (node && $isTextNode(node)) {
                    node.setStyle(previousStyles.get(key) ?? '')
                }
            })
        }, { tag: 'historic' })

        menuHighlightNodeKeysRef.current = []
        menuHighlightStylesRef.current = new Map()
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
        clearMenuSelectionHighlight()
        selectionSnapshotRef.current = {
            range: null,
            nodeKeys: [],
            text: '',
            prefix: '',
            suffix: '',
            diffPosition: null,
        }
    }, [editor, clearMenuSelectionHighlight])

    const applyMenuSelectionHighlight = useCallback(() => {
        const { range, nodeKeys } = selectionSnapshotRef.current
        if (!range && nodeKeys.length === 0) return

        clearMenuSelectionHighlight()

        const capturedStyles = new Map<string, string>()
        const applyBlueHighlight = (node: LexicalNode) => {
            if (!$isTextNode(node)) return
            const existingStyle = node.getStyle()
            capturedStyles.set(node.getKey(), existingStyle)
            const separator = existingStyle && !existingStyle.trim().endsWith(';') ? '; ' : ' '
            node.setStyle(`${existingStyle}${separator}background-color: #dbeafe;`)
        }

        editor.update(() => {
            if (range) {
                const { startKey, startOffset, endKey, endOffset } = range
                const startNode = $getNodeByKey(startKey)
                const endNode = $getNodeByKey(endKey)
    
                if (startNode && endNode && $isTextNode(startNode) && $isTextNode(endNode)) {
                    if (startKey === endKey) {
                        const size = startNode.getTextContentSize()
                        if (startOffset < endOffset && startOffset < size) {
                            const end = Math.min(endOffset, size)
                            const parts = startNode.splitText(startOffset, end)
                            const selectedNode = startOffset === 0
                                ? parts[0]
                                : parts.length >= 2 ? parts[1] : parts[0]
                            if (selectedNode) {
                                applyBlueHighlight(selectedNode)
                            }
                        }
                    } else {
                        const firstNode = startNode.getWritable()
                        const lastNode = endNode.getWritable()
                        const firstSize = firstNode.getTextContentSize()
                        const lastSize = lastNode.getTextContentSize()

                        let firstSelected: LexicalNode | null = null
                        if (startOffset > 0 && startOffset < firstSize) {
                            const [, right] = firstNode.splitText(startOffset)
                            firstSelected = right
                        } else if (startOffset === 0) {
                            firstSelected = firstNode
                        }

                        const nodeAfterFirst = firstSelected ?? firstNode
                        let current: LexicalNode | null = nodeAfterFirst.getNextSibling()
                        const lastNodeKey = lastNode.getKey()
                        const middleNodes: LexicalNode[] = []
                        while (current && current.getKey() !== lastNodeKey) {
                            if ($isTextNode(current)) middleNodes.push(current)
                            current = current.getNextSibling()
                        }

                        let lastSelected: LexicalNode | null = null
                        if (endOffset > 0 && endOffset < lastSize) {
                            const [left] = lastNode.splitText(endOffset)
                            lastSelected = left
                        } else if (endOffset >= lastSize) {
                            lastSelected = lastNode
                        }

                        const seen = new Set<string>()
                        const maybeHighlight = (node: LexicalNode | null) => {
                            if (!node || !$isTextNode(node)) return
                            const key = node.getKey()
                            if (seen.has(key)) return
                            seen.add(key)
                            applyBlueHighlight(node)
                        }

                        maybeHighlight(firstSelected)
                        middleNodes.forEach(node => maybeHighlight(node))
                        maybeHighlight(lastSelected)
                    }

                    return
                }
            }

            // Fallback when range is unavailable or stale.
            nodeKeys.forEach(key => {
                const node = $getNodeByKey(key)
                if (node) applyBlueHighlight(node)
            })
        }, { tag: 'historic' })

        menuHighlightNodeKeysRef.current = Array.from(capturedStyles.keys())
        menuHighlightStylesRef.current = capturedStyles
    }, [editor, clearMenuSelectionHighlight])

    const clearPreviousRevisionDiff = useCallback(() => {
        const suggestedKeys = suggestedNodeKeysRef.current
        const highlightedKeys = highlightedNodeKeysRef.current
        if (suggestedKeys.length === 0 && highlightedKeys.length === 0) return

        editor.update(() => {
            suggestedKeys.forEach(key => {
                try {
                    const suggestedNode = $getNodeByKey(key)
                    if (suggestedNode) {
                        const prevSibling = suggestedNode.getPreviousSibling()
                        suggestedNode.remove()
                        if (prevSibling && prevSibling.getType() === 'linebreak') {
                            prevSibling.remove()
                        }
                    }
                } catch {
                    // Node might have been removed
                }
            })
            highlightedKeys.forEach(key => {
                try {
                    const node = $getNodeByKey(key)
                    if (node && $isTextNode(node)) {
                        node.setStyle('')
                        node.setMode('normal')
                    }
                } catch {
                    // Node might have been removed
                }
            })
        }, { tag: 'historic' })

        setHighlightedNodeKeys([])
        setSuggestedNodeKeys([])
        setStoredSelectionRange(null)
        pendingTargetNodeKeysRef.current = []
    }, [editor])

    const handleRevision = useCallback(async (action: RevisionAction, customPrompt?: string) => {
        if (isRevising) return

        // Clear any previous revision diff and result before starting a new one to prevent
        // "both diffs" showing and applying stale result to new selection
        clearPreviousRevisionDiff()
        rejectRevision()
        const textToRevise = selectedText || selectionSnapshotRef.current.text
        if (!textToRevise.trim()) return
        if (!providerName?.trim()) {
            setShowMenu(false)
            showWarning()
            return
        }

        // Before clearing highlights, capture the range from the currently-highlighted nodes.
        // applyMenuSelectionHighlight() splits text nodes at selection boundaries, so the
        // original snapshot keys/offsets may now point to a shorter prefix node with stale
        // offsets. The highlighted node keys always refer to the exact nodes that need to be
        // replaced, so we prefer those when available.
        let highlightBasedRange: StoredSelectionRange | null = null
        const highlightedKeys = menuHighlightNodeKeysRef.current
        if (highlightedKeys.length > 0) {
            editor.getEditorState().read(() => {
                const firstNode = $getNodeByKey(highlightedKeys[0])
                const lastNode = $getNodeByKey(highlightedKeys[highlightedKeys.length - 1])
                if (firstNode && lastNode && $isTextNode(firstNode) && $isTextNode(lastNode)) {
                    highlightBasedRange = {
                        startKey: firstNode.getKey(),
                        startOffset: 0,
                        endKey: lastNode.getKey(),
                        endOffset: lastNode.getTextContentSize(),
                    }
                }
            })
        }

        // Store node keys for later highlighting (after result is ready)
        let nodeKeys: string[] = []
        editor.getEditorState().read(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
                nodeKeys = selection.getNodes().map(node => node.getKey())
            }
        })

        const selectedNodeKeys =
        highlightedKeys.length > 0
            ? highlightedKeys
            : nodeKeys.length > 0
                ? nodeKeys
                : selectionSnapshotRef.current.nodeKeys
        pendingTargetNodeKeysRef.current = selectedNodeKeys

        // Mark request as in-flight before closing the menu to avoid cleanup timing races.
        revisionInFlightRef.current = true
        setShowMenu(false)

        // Store selection range for later replacement and highlighting.
        // Prefer the range derived from the highlighted nodes (post-split), then the live
        // editor selection, then the snapshot captured before any node splits.
        const liveSelectionRange = getSelectionRange()
        const selectionRange = highlightBasedRange || liveSelectionRange || selectionSnapshotRef.current.range
        setStoredSelectionRange(selectionRange)

        setHighlightedNodeKeys(selectedNodeKeys)

        // Get the position for the loading indicator (near the selection, relative to editor)
        const selection = window.getSelection()
        const editorRoot = editor.getRootElement()
        if (selection && selection.rangeCount > 0 && editorRoot) {
            const range = selection.getRangeAt(0)
            const commonAncestor = range.commonAncestorContainer
            const isInsideEditor =
                commonAncestor === editorRoot || editorRoot.contains(commonAncestor)

            if (isInsideEditor) {
                const rect = range.getBoundingClientRect()
                const editorRect = editorRoot.getBoundingClientRect()
                setDiffPosition({
                    x: rect.left - editorRect.left,
                    y: rect.bottom - editorRect.top + 8  // 8px gap below selection
                })
            } else if (selectionSnapshotRef.current.diffPosition) {
                setDiffPosition(selectionSnapshotRef.current.diffPosition)
            }
        } else if (selectionSnapshotRef.current.diffPosition) {
            setDiffPosition(selectionSnapshotRef.current.diffPosition)
        }

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
            await reviseText(textToRevise, action, customPrompt, hookSelectionRange, selectionContext)
        } finally {
            revisionInFlightRef.current = false
        }
    }, [selectedText, providerName, getSelectionRange, reviseText, rejectRevision, showWarning, editor, isRevising, clearPreviousRevisionDiff])

    // Apply red highlighting to selected range and stream/update green suggestion text.
    useEffect(() => {
        if (!revisionResult || !storedSelectionRange) return

        editor.setEditable(false)

        let newSuggestedKey = ''
        let keysToHighlight: string[] = []
    
        editor.update(() => {
            let effectiveRange = storedSelectionRange
            let { startKey, startOffset, endKey, endOffset } = effectiveRange
            let startNode = $getNodeByKey(startKey)
            let endNode = $getNodeByKey(endKey)

            if (!startNode || !endNode || !$isTextNode(startNode) || !$isTextNode(endNode)) {
                const fallbackTextNodes = pendingTargetNodeKeysRef.current
                    .map(key => $getNodeByKey(key))
                    .filter((node): node is ReturnType<typeof $createTextNode> => Boolean(node && $isTextNode(node)))

                if (fallbackTextNodes.length > 0) {
                    const firstFallback = fallbackTextNodes[0]
                    const lastFallback = fallbackTextNodes[fallbackTextNodes.length - 1]
                    effectiveRange = {
                        startKey: firstFallback.getKey(),
                        startOffset: 0,
                        endKey: lastFallback.getKey(),
                        endOffset: lastFallback.getTextContentSize(),
                    }
                    ;({ startKey, startOffset, endKey, endOffset } = effectiveRange)
                    startNode = firstFallback
                    endNode = lastFallback
                    setStoredSelectionRange(effectiveRange)
                }
            }

            if (!startNode || !endNode || !$isTextNode(startNode) || !$isTextNode(endNode)) {
                // Nodes may have been invalidated (e.g. document edited during long revision)
                setHighlightedNodeKeys([])
                setStoredSelectionRange(null)
                rejectRevision()
                return
            }

            if (startKey === endKey) {
                // Selection within a single text node: split at start and end, highlight only the middle part
                const size = startNode.getTextContentSize()
                if (startOffset >= endOffset || startOffset >= size) {
                    setHighlightedNodeKeys([])
                    setStoredSelectionRange(null)
                    rejectRevision()
                    return
                }
                const end = Math.min(endOffset, size)
                const parts = startNode.splitText(startOffset, end)
                // When startOffset === 0, Lexical skips the boundary split so parts[0] IS the selected
                // text. When startOffset > 0, parts[0] is the pre-selection head and parts[1] is selected.
                const selectedNode = startOffset === 0
                    ? parts[0]
                    : parts.length >= 2 ? parts[1] : parts[0]
                if (selectedNode) {
                    keysToHighlight = [selectedNode.getKey()]
                    selectedNode.setStyle('background-color: #fee2e2; color: #991b1b;')
                    selectedNode.setMode('token')
                }
            } else {
                // Selection spans multiple nodes: split first at startOffset, collect middle, then split last at endOffset
                const firstNode = startNode.getWritable()
                const lastNode = endNode.getWritable()
                const firstSize = firstNode.getTextContentSize()
                const lastSize = lastNode.getTextContentSize()

                let firstSelected: LexicalNode | null = null
                if (startOffset > 0 && startOffset < firstSize) {
                    const [, right] = firstNode.splitText(startOffset)
                    firstSelected = right
                } else if (startOffset === 0) {
                    firstSelected = firstNode
                }

                // Collect middle nodes (between first and last) before splitting the last node
                const nodeAfterFirst = firstSelected ?? firstNode
                let current: LexicalNode | null = nodeAfterFirst.getNextSibling()
                const lastNodeKey = lastNode.getKey()
                const middleNodes: LexicalNode[] = []
                while (current && current.getKey() !== lastNodeKey) {
                    if ($isTextNode(current)) middleNodes.push(current)
                    current = current.getNextSibling()
                }

                let lastSelected: LexicalNode | null = null
                if (endOffset > 0 && endOffset < lastSize) {
                    const [left] = lastNode.splitText(endOffset)
                    lastSelected = left
                } else if (endOffset >= lastSize) {
                    lastSelected = lastNode
                }

                const toHighlight: LexicalNode[] = []
                if (firstSelected) toHighlight.push(firstSelected)
                toHighlight.push(...middleNodes)
                if (lastSelected && lastSelected.getKey() !== firstSelected?.getKey()) toHighlight.push(lastSelected)

                keysToHighlight = toHighlight.map(n => n.getKey())
                toHighlight.forEach(node => {
                    if ($isTextNode(node)) {
                        node.setStyle('background-color: #fee2e2; color: #991b1b;')
                        node.setMode('token')
                    }
                })
            }

            setHighlightedNodeKeys(keysToHighlight)
            pendingTargetNodeKeysRef.current = keysToHighlight

            // Insert green suggested text after the highlighted range (end of last highlighted node).
            // Always create a fresh selection here - the editor may have lost focus (e.g. the user
            // was typing in the quick-edit input), so $getSelection() can return null. Using
            // $createRangeSelection + $setSelection guarantees the insertion works regardless.
            if (keysToHighlight.length > 0 && revisionResult.revised) {
                const lastHighlightedKey = keysToHighlight[keysToHighlight.length - 1]
                const lastHighlighted = $getNodeByKey(lastHighlightedKey)
                if (lastHighlighted && $isTextNode(lastHighlighted)) {
                    const endOffsetInsert = lastHighlighted.getTextContentSize()
                    const insertSelection = $createRangeSelection()
                    insertSelection.anchor.set(lastHighlightedKey, endOffsetInsert, 'text')
                    insertSelection.focus.set(lastHighlightedKey, endOffsetInsert, 'text')
                    $setSelection(insertSelection)

                    const lineBreak = $createLineBreakNode()
                    insertSelection.insertNodes([lineBreak])

                    const suggestedNode = $createTextNode(revisionResult.revised)
                    suggestedNode.setStyle('background-color: #dcfce7; color: #166534;')
                    insertSelection.insertNodes([suggestedNode])

                    setSuggestedNodeKeys([suggestedNode.getKey()])
                    newSuggestedKey = suggestedNode.getKey()
                }
            }
        }, { tag: 'historic' })

        editor.setEditable(true)

        if (newSuggestedKey) {
            const keyToUse = newSuggestedKey
            // Use requestAnimationFrame to ensure DOM is ready after Lexical updates (fixes timing
            // when revision takes longer and DOM updates are deferred)
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const editorRoot = editor.getRootElement()
                    if (!editorRoot) return
                    const domElement = editor.getElementByKey(keyToUse) as HTMLElement | null
                    if (!domElement) return
                    const pos = getNodeEndPosition(domElement, editorRoot)
                    if (pos) setButtonPosition(pos)
                })
            })
        }
    }, [revisionResult, storedSelectionRange, editor, rejectRevision])

    // Clear warning timeout on unmount
    useEffect(() => {
        return () => {
            if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current)
            clearMenuSelectionHighlight()
        }
    }, [clearMenuSelectionHighlight])

    useEffect(() => {
        if (!showMenu) {
            if (revisionInFlightRef.current) return
            clearMenuSelectionHighlight()
        }
    }, [showMenu, clearMenuSelectionHighlight])

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

    // Recalculate button position on window resize so it always tracks the suggested node
    useEffect(() => {
        if (suggestedNodeKeys.length === 0) return

        const handleResize = () => {
            const editorRoot = editor.getRootElement()
            if (!editorRoot) return
            const domElement = editor.getElementByKey(suggestedNodeKeys[0]) as HTMLElement | null
            if (!domElement) return
            const pos = getNodeEndPosition(domElement, editorRoot)
            if (pos) setButtonPosition(pos)
        }

        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [suggestedNodeKeys, editor])

    // Keep revision UI state in sync with editor history changes (e.g. Undo/Redo).
    // If diff nodes disappear from the document, also clear accept/reject controls.
    useEffect(() => {
        if (!revisionResult && suggestedNodeKeys.length === 0) return

        const unregister = editor.registerUpdateListener(({ editorState }) => {
            let hasSuggestedNode = false
            editorState.read(() => {
                hasSuggestedNode = suggestedNodeKeys.some(key => Boolean($getNodeByKey(key)))
            })

            if (!hasSuggestedNode && suggestedNodeKeys.length > 0) {
                setSuggestedNodeKeys([])
                setHighlightedNodeKeys([])
                setStoredSelectionRange(null)
                rejectRevision()
            }
        })

        return unregister
    }, [editor, revisionResult, suggestedNodeKeys, rejectRevision])

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
                    }
                } else {
                    if (!showMenu) {
                        setSelectedText('')
                    }
                }
            })
        })

        return unregister
    }, [editor, showMenu])

    // Listen for global shortcuts from Electron
    useEffect(() => {
        const handleShortcut = (event: Event) => {
            const customEvent = event as CustomEvent
            const { type, payload, mode } = customEvent.detail as {
                type: string
                payload?: RevisionAction | { action?: RevisionAction; customPrompt?: string }
                mode?: 'menu' | 'custom'
            }

            const payloadAction =
                typeof payload === 'string' ? payload : payload?.action
            const payloadPrompt =
                typeof payload === 'string' ? undefined : payload?.customPrompt

            if (!providerName?.trim()) {
                if ((type === 'revision-menu' || type === 'revision') && selectedText) {
                    showWarning()
                }
                return
            }

            if (type === 'revision-menu' && selectedText) {
                captureSelectionSnapshot()
                const nextMode = mode === 'custom' ? 'custom' : 'menu'
                setMenuMode(nextMode)
                setShowMenu(true)
                if (nextMode === 'custom') {
                    applyMenuSelectionHighlight()
                } else {
                    clearMenuSelectionHighlight()
                }
                // Get cursor position for menu
                const selection = window.getSelection()
                if (selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0)
                    const rect = range.getBoundingClientRect()
                    setMenuPosition({ x: rect.left, y: rect.bottom + 5 })
                }
            } else if (type === 'revision' && selectedText) {
                if (payloadAction === 'custom' && payloadPrompt) {
                    handleRevision('custom', payloadPrompt)
                    return
                }

                if (payloadAction === 'custom') {
                    captureSelectionSnapshot()
                    setMenuMode('custom')
                    setShowMenu(true)
                    applyMenuSelectionHighlight()
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
    }, [selectedText, providerName, handleRevision, showWarning, captureSelectionSnapshot, applyMenuSelectionHighlight, clearMenuSelectionHighlight])

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
                applyMenuSelectionHighlight()
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
    }, [editor, selectedText, providerName, showWarning, captureSelectionSnapshot, applyMenuSelectionHighlight, customShortcuts, handleRevision])

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

    const handleAccept = () => {
        editor.update(() => {
            // Get the current text from the suggested node (it might have been edited)
            let acceptedText = revisionResult?.revised || ''
            if (suggestedNodeKeys.length > 0) {
                try {
                    const suggestedNode = $getNodeByKey(suggestedNodeKeys[0])
                    if (suggestedNode && $isTextNode(suggestedNode)) {
                        acceptedText = suggestedNode.getTextContent()
                        // Remove the green suggestion node and the line break before it
                        const prevSibling = suggestedNode.getPreviousSibling()
                        suggestedNode.remove()
                        if (prevSibling && prevSibling.getType() === 'linebreak') {
                            prevSibling.remove()
                        }
                    }
                } catch (e) {
                    // Node might have been removed
                }
            }

            // Use current highlighted nodes as the replacement target because the preview
            // flow can split nodes and invalidate the original stored offsets/keys.
            let replacementRange: StoredSelectionRange | null = null
            const highlightedTextNodes: ReturnType<typeof $createTextNode>[] = []
            highlightedNodeKeys.forEach(key => {
                const node = $getNodeByKey(key)
                if (node && $isTextNode(node)) {
                    highlightedTextNodes.push(node)
                }
            })

            if (highlightedTextNodes.length > 0) {
                const first = highlightedTextNodes[0]
                const last = highlightedTextNodes[highlightedTextNodes.length - 1]
                replacementRange = {
                    startKey: first.getKey(),
                    startOffset: 0,
                    endKey: last.getKey(),
                    endOffset: last.getTextContentSize(),
                }
            } else if (storedSelectionRange) {
                replacementRange = storedSelectionRange
            }

            // Clear highlighting from all highlighted nodes and restore editability
            highlightedNodeKeys.forEach(key => {
                try {
                    const node = $getNodeByKey(key)
                    if (node && $isTextNode(node)) {
                        node.setStyle('')
                        node.setMode('normal') // Restore editability
                    }
                } catch (e) {
                    // Node might have been removed
                }
            })

            // Replace the selected text with accepted text (works even if editor lost focus).
            if (replacementRange) {
                const selection = $createRangeSelection()
                selection.anchor.set(replacementRange.startKey, replacementRange.startOffset, 'text')
                selection.focus.set(replacementRange.endKey, replacementRange.endOffset, 'text')
                $setSelection(selection)
                selection.insertText(acceptedText)
            }

            setHighlightedNodeKeys([])
            setSuggestedNodeKeys([])
            setStoredSelectionRange(null)
        })

        acceptRevision(revisionResult?.revised)
    }

    const handleReject = () => {
        // Clear red highlighting and remove green suggestion without replacing text
        editor.update(() => {
            // Remove the green suggested text and line break
            suggestedNodeKeys.forEach(key => {
                try {
                    const suggestedNode = $getNodeByKey(key)
                    if (suggestedNode) {
                        // Remove the line break before the suggestion
                        const prevSibling = suggestedNode.getPreviousSibling()
                        suggestedNode.remove()
                        if (prevSibling && prevSibling.getType() === 'linebreak') {
                            prevSibling.remove()
                        }
                    }
                } catch (e) {
                    // Node might have been removed
                }
            })

            // Clear red highlighting and restore editability
            highlightedNodeKeys.forEach(key => {
                try {
                    const node = $getNodeByKey(key)
                    if (node && $isTextNode(node)) {
                        node.setStyle('')
                        node.setMode('normal') // Restore editability
                    }
                } catch (e) {
                    // Node might have been removed
                }
            })

            setHighlightedNodeKeys([])
            setSuggestedNodeKeys([])
            setStoredSelectionRange(null)
        }, { tag: 'historic' })

        rejectRevision()
    }

    return (
        <>
            {showMenu && selectedText && (
                <RevisionMenu
                    position={menuPosition}
                    onSelect={handleRevision}
                    onClose={() => {
                        clearMenuSelectionHighlight()
                        setShowMenu(false)
                    }}
                    initialMode={menuMode}
                    onCustomOpen={applyMenuSelectionHighlight}
                    customShortcuts={customShortcuts}
                />
            )}

            {isRevising && !revisionResult && (
                <div
                    className="absolute z-50 bg-white rounded-lg shadow-lg border border-gray-200 px-4 py-3 flex items-center gap-3"
                    style={{
                        left: diffPosition.x,
                        top: diffPosition.y,
                    }}
                >
                    <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                    <span className="text-sm text-gray-700">Generating suggestion...</span>
                </div>
            )}

            {revisionResult && suggestedNodeKeys.length > 0 && (
                <div
                    className="absolute z-50 bg-white rounded-lg shadow-lg border border-gray-200 px-3 py-2 flex items-center gap-3"
                    style={{
                        left: buttonPosition.x,
                        top: buttonPosition.y,
                    }}
                >
                    <button
                        onClick={handleAccept}
                        className="text-blue-600 hover:text-blue-700 font-medium text-sm"
                        disabled={isRevising}
                        type="button"
                    >
                        Accept
                    </button>
                    <button
                        onClick={handleReject}
                        className="text-gray-600 hover:text-gray-800 text-sm"
                        disabled={isRevising}
                        type="button"
                    >
                        Reject
                    </button>
                </div>
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
