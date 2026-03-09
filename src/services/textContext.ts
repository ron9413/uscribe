/**
 * Shared utilities for extracting and truncating text context (prefix/suffix)
 * used by both autocomplete and revision templates.
 */

function truncatePrefix(prefix: string, maxPrefixLength: number): string {
    if (prefix.length <= maxPrefixLength) return prefix
    return prefix.substring(prefix.length - maxPrefixLength)
}

function truncateSuffix(suffix: string, maxSuffixLength: number): string {
    const newlineIndex = suffix.indexOf('\n')
    let limited = newlineIndex === -1 ? suffix : suffix.substring(0, newlineIndex)
    if (limited.length > maxSuffixLength) {
        limited = limited.substring(0, maxSuffixLength) + '...'
    }
    return limited
}

export interface ExtractPrefixSuffixOptions {
    /** Selection end; when omitted, suffix starts at cursorOrStart (cursor mode) */
    endPosition?: number
    maxPrefixLength?: number
    maxSuffixLength?: number
}

/**
 * Extracts prefix and suffix from full text around a cursor or selection.
 * Truncates to stay within token limits and keep suffix within current paragraph.
 * 
 * @param fullText - The full document text
 * @param cursorOrStart - The cursor position (for autocomplete) or selection start (for revision)
 * @param options - Optional endPosition (for selection), maxPrefixLength, maxSuffixLength
 */
export function extractPrefixSuffix(
    fullText: string,
    cursorOrStart: number,
    options: ExtractPrefixSuffixOptions = {}
): { prefix: string; suffix: string } {
    const {
        endPosition,
        maxPrefixLength = 1000,
        maxSuffixLength = 500
    } = options
    const suffixStart = endPosition ?? cursorOrStart
    const prefix = truncatePrefix(
        fullText.substring(0, cursorOrStart),
        maxPrefixLength
    )
    const suffix = truncateSuffix(
        fullText.substring(suffixStart),
        maxSuffixLength
    )
    return { prefix, suffix }
}

/**
 * Truncates pre-extracted prefix and suffix (e.g. from DOM selection)
 * using the same logic as extractPrefixSuffix
 */
export function truncatePrefixSuffix(
    prefix: string,
    suffix: string,
    maxPrefixLength: number = 1000,
    maxSuffixLength: number = 500
): { prefix: string; suffix: string } {
    return {
        prefix: truncatePrefix(prefix, maxPrefixLength),
        suffix: truncateSuffix(suffix, maxSuffixLength)
    }
}
