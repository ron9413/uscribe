import { useState, useCallback, useRef } from 'react'
import { aiService } from '../services/aiService'
import { RevisionAction } from '../types'
import { Change, diffChars } from 'diff'

interface UseTextRevisionOptions {
    providerName: string
}

interface RevisionResult {
    original: string
    revised: string
    diff: Change[]
}

interface SelectionRange {
    anchorOffset: number
    focusOffset: number
    anchorKey: string
    focusKey: string
}

interface RevisionContext {
    prefix: string
    suffix: string
}

export function useTextRevision(options: UseTextRevisionOptions) {
    const [isRevising, setIsRevising] = useState(false)
    const [revisionResult, setRevisionResult] = useState<RevisionResult | null>(null)
    const selectionRangeRef = useRef<SelectionRange | null>(null)
    const abortControllerRef = useRef<AbortController | null>(null)
    const activeRequestIdRef = useRef(0)

    const reviseText = useCallback(async (
        text: string,
        action: RevisionAction,
        customPrompt?: string,
        selectionRange?: SelectionRange,
        context?: RevisionContext
    ) => {
        // Cancel any in-flight revision
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }

        // Store selection range for later use
        if (selectionRange) {
            selectionRangeRef.current = selectionRange
        }

        // Clear any previous result to prevent applying stale diff with new selection
        setRevisionResult(null)
        setIsRevising(true)
        const requestController = new AbortController()
        abortControllerRef.current = requestController
        const requestId = activeRequestIdRef.current + 1
        activeRequestIdRef.current = requestId

        try {
            const revised = await aiService.reviseText(
                options.providerName,
                text,
                action,
                customPrompt,
                context
            )

            // Ignore stale results from superseded requests.
            if (
                requestController.signal.aborted ||
                activeRequestIdRef.current !== requestId
            ) {
                return null
            }

            const diff = diffChars(text, revised)
    
            setRevisionResult({
                original: text,
                revised,
                diff,
            })

            return revised
        } catch (error) {
            if (
                (error instanceof Error && error.name === 'AbortError') ||
                requestController.signal.aborted ||
                activeRequestIdRef.current !== requestId
            ) {
                console.log('Revision cancelled')
                return null
            }
            console.error('Revision error:', error)
            throw error
        } finally {
            if (activeRequestIdRef.current === requestId) {
                setIsRevising(false)
                abortControllerRef.current = null
            }
        }
    }, [options.providerName])

    const updateRevision = useCallback((newText: string) => {
        if (!revisionResult) return

        // Recalculate diff with the new edited text
        const diff = diffChars(revisionResult.original, newText)

        setRevisionResult({
            ...revisionResult,
            revised: newText,
            diff,
        })
    }, [revisionResult])

    const acceptRevision = useCallback((editedText?: string) => {
        const result = revisionResult
        const range = selectionRangeRef.current
        setRevisionResult(null)
        selectionRangeRef.current = null

        return {
            text: editedText || result?.revised || null, 
            selectionRange: range,
        }
    }, [revisionResult])

    const rejectRevision = useCallback(() => {
        setRevisionResult(null)
        selectionRangeRef.current = null
    }, [])

    const cancelRevision = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        activeRequestIdRef.current += 1
        setIsRevising(false)
        setRevisionResult(null)
        selectionRangeRef.current = null
    }, [])

    return {
        reviseText,
        isRevising,
        revisionResult,
        acceptRevision,
        rejectRevision,
        updateRevision,
        cancelRevision,
    }
}
