import { useState, useEffect, useRef, useCallback } from 'react'
import { aiService } from '../services/aiService'
import { extractPrefixSuffix } from '../services/autocompleteTemplates'

interface UseAutoCompleteOptions {
    providerName: string
    delay: number
    enabled: boolean
}

interface AutoCompleteResult {
    suggestion: string
    isLoading: boolean
    accept: () => void
    reject: () => void
}

interface AutoCompleteContext {
    fullText: string
    cursorPosition: number
}

function sanitizeAutocompleteOutput(raw: string): string {
    let cleaned = raw

    // Some models may echo prompt scaffolding; keep only generated continuation.
    const holeMarker = '[COMPLETE_HERE]'
    const markerIndex = cleaned.lastIndexOf(holeMarker)
    if (markerIndex !== -1) {
        cleaned = cleaned.slice(markerIndex + holeMarker.length)
    }

    const continuationHeaderIndex = cleaned.indexOf('\n\nContinuation:')
    if (continuationHeaderIndex !== -1) {
        cleaned = cleaned.slice(0, continuationHeaderIndex)
    }

    cleaned = cleaned.replace(/^Continuation:\s*/i, '')

    return cleaned
 }

export function useAutoComplete(
    contextData: AutoCompleteContext,
    onAccept: (text: string) => void,
    options: UseAutoCompleteOptions
): AutoCompleteResult {
    const { fullText, cursorPosition } = contextData
    const [suggestion, setSuggestion] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const debounceTimer = useRef<NodeJS.Timeout>()
    const abortController = useRef<AbortController>()
    const activeRequestIdRef = useRef(0)
    const lastRejectionRef = useRef<{
        timestamp: number
        textLength: number
        text: string
    } | null>(null)
    const lastContextRef = useRef<{
        text: string
        length: number
    } | null>(null)
    const lastAcceptedTextRef = useRef<string | null>(null)
    const lastPreAcceptTextRef = useRef<string | null>(null)

    const fetchSuggestion = useCallback(async () => {
        if (!options.enabled) {
            console.log('Autocomplete disabled')
            setSuggestion('')
            return
        }

        if (!fullText.trim()) {
            console.log('No context available')
            setSuggestion('')
            return
        }

        if (fullText.length < 10) {
            console.log('Context too short:', fullText.length)
            setSuggestion('')
            return
        }

        // Smart rejection logic: prevent annoying suggestions
        const currentLength = fullText.length
        const currentText = fullText

        // Don't trigger autocomplete during accept transition:
        // - while the editor still has pre-accept text
        // - after it becomes accepted text
        // Only re-enable once the user makes a new edit beyond both states.
        if (lastAcceptedTextRef.current) {
            const isPreAcceptText =
                lastPreAcceptTextRef.current !== null &&
                currentText === lastPreAcceptTextRef.current
            const isAcceptedText = currentText === lastAcceptedTextRef.current
        
            if (isPreAcceptText || isAcceptedText) {
                console.log('Skipping suggestion: accept transition in progress or no new changes')
                setSuggestion('')
                setIsLoading(false)
                lastContextRef.current = { text: currentText, length: currentLength }
                return
            }
            lastAcceptedTextRef.current = null
            lastPreAcceptTextRef.current = null
        }

        // Check if text hasn't changed since last context
        if (lastContextRef.current && currentText === lastContextRef.current.text) {
            console.log('Skipping suggestion: text unchanged')
            setSuggestion('')
            setIsLoading(false)
            return
        }

        // Check if user just rejected a suggestion and hasn't typed much since
        if (lastRejectionRef.current) {
            const timeSinceRejection = Date.now() - lastRejectionRef.current.timestamp
            const textLengthChange = Math.abs(currentLength - lastRejectionRef.current.textLength)

            if (timeSinceRejection < 2000 && textLengthChange < 10) {
                console.log('Skipping suggestion: recent rejection with minimal new text')
                setSuggestion('')
                lastContextRef.current = { text: currentText, length: currentLength }
                return
            }
        }

        // Update last context
        lastContextRef.current = { text: currentText, length: currentLength }

        setIsLoading(true)
        const requestId = ++activeRequestIdRef.current
        const controller = new AbortController()
        abortController.current = controller

        try {
            // Extract prefix and suffix using optimized extraction
            const { prefix, suffix } = extractPrefixSuffix(
                fullText,
                cursorPosition,
                1000, // Max 1000 chars before cursor
                500   // Max 500 chars after cursor
            )

            let fullSuggestion = ''
            const stream = aiService.streamAutocomplete(
                options.providerName,
                {
                    prefix,
                    suffix,
                    maxTokens: 100,
                    temperature: 0.3,
                },
            )

            for await (const chunk of stream) {
                if (controller.signal.aborted || requestId !== activeRequestIdRef.current) break
                fullSuggestion += chunk

                // Preserve model-generated whitespace, only stop at paragraph breaks
                let processedSuggestion = sanitizeAutocompleteOutput(fullSuggestion)

                // Stop at double newlines (paragraph break) as this is a natural completion boundary
                const doubleNewlineIndex = processedSuggestion.indexOf('\n\n')
                if (doubleNewlineIndex !== -1) {
                    processedSuggestion = processedSuggestion.substring(0, doubleNewlineIndex)
                }

                if (requestId !== activeRequestIdRef.current) break
                setSuggestion(processedSuggestion)
            }

            console.log('Autocomplete suggestion received:', fullSuggestion.substring(0, 50))
        } catch (error: any) {
            if (error.name !== 'AbortError') {
                console.error('Auto-complete error:', error)
            }
            setSuggestion('')
        } finally {
            if (requestId === activeRequestIdRef.current) {
                setIsLoading(false)
            }
        }
    }, [fullText, cursorPosition, options.enabled, options.providerName])

    useEffect(() => {
        // Clear previous timer and abort previous request
        if (debounceTimer.current) {
            clearTimeout(debounceTimer.current)
        }
        if (abortController.current) {
            activeRequestIdRef.current += 1
            abortController.current.abort()
        }

        setSuggestion('')

        if (!options.enabled) return

        // Debounce the fetch
        debounceTimer.current = setTimeout(() => {
            fetchSuggestion()
        }, options.delay)

        return () => {
            if (debounceTimer.current) {
                clearTimeout(debounceTimer.current)
            }
            if (abortController.current) {
                activeRequestIdRef.current += 1
                abortController.current.abort()
            }
        }
    }, [contextData.fullText, contextData.cursorPosition, fetchSuggestion, options.delay, options.enabled])

    const accept = useCallback(() => {
        if (suggestion) {
            const expectedAcceptedText =
                fullText.slice(0, cursorPosition) +
                suggestion +
                fullText.slice(cursorPosition)
            lastPreAcceptTextRef.current = fullText
            lastAcceptedTextRef.current = expectedAcceptedText
            lastContextRef.current = {
                text: expectedAcceptedText,
                length: expectedAcceptedText.length,
            }
            activeRequestIdRef.current += 1
            if (abortController.current) {
                abortController.current.abort()
            }
            onAccept(suggestion)
            setSuggestion('')
            setIsLoading(false)
        }
    }, [suggestion, onAccept, fullText, cursorPosition])

    const reject = useCallback(() => {
        // Store rejection info to prevent immediate re-suggestions
        lastRejectionRef.current = {
            timestamp: Date.now(),
            textLength: fullText.length,
            text: fullText
        }

        setSuggestion('')
        if (abortController.current) {
            activeRequestIdRef.current += 1
            abortController.current.abort()
        }
    }, [fullText])

    return {
        suggestion,
        isLoading,
        accept,
        reject,
    }
}
