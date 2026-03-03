import { AutocompleteTemplate } from './types'

export const standardSentenceTemplate: AutocompleteTemplate = {
    template: (prefix: string, suffix: string) => {
        return `Complete the next part of the sentence.
Return only the continuation text.
Keep it short and natural (typically one sentence).

${prefix}[COMPLETE_HERE]${suffix}

Continuation:`
    },
    completionOptions: {
        stop: ['\n\n', '[COMPLETE_HERE]', '\n##', '\n---', '\n==='],
        maxTokens: 100,
        temperature: 0.3,
    },
}
