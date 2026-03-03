export function extractPrefixSuffix(
    fullText: string,
    cursorPosition: number,
    maxPrefixLength: number = 1000,
    maxSuffixLength: number = 500
): { prefix: string; suffix: string } {
    let prefix = fullText.substring(0, cursorPosition)
    if (prefix.length > maxPrefixLength) {
        // Keep the newest prefix context closest to the cursor.
        // Trim from the beginning and preserve the end.
        prefix = prefix.substring(prefix.length - maxPrefixLength)
    }

    // Keep suffix within the current paragraph only; avoid pulling text
    // from following paragraphs into the autocomplete context.
    const suffixFromCursor = fullText.substring(cursorPosition)
    const newlineIndex = suffixFromCursor.indexOf('\n')
    let suffix =
        newlineIndex === -1
            ? suffixFromCursor
            : suffixFromCursor.substring(0, newlineIndex)

    if (suffix.length > maxSuffixLength) {
        suffix = suffix.substring(0, maxSuffixLength) + '...'
    }

    return { prefix, suffix }
}
