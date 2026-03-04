export interface AutocompletePrompt {
    systemPrompt: string
    userPrompt: string
}

export function buildAutocompletePrompt(prefix: string, suffix: string): AutocompletePrompt {
    return {
        systemPrompt: `You are an AI writing assistant.
Continue text naturally and seamlessly.
Return only the continuation text with no explanations.
Keep the continuation concise (typically one sentence).`,
        userPrompt: `Complete the next part of the sentence.

${prefix}[COMPLETE_HERE]${suffix}

Continuation:`,
    }
}
