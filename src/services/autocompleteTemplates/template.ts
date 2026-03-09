import { buildAutocompletePrompt, type AutocompletePrompt } from "./promptBuilder";

export const DEFAULT_AUTOCOMPLETE_MAX_TOKENS = 100
export const DEFAULT_AUTOCOMPLETE_TEMPERATURE = 0.3

export { extractPrefixSuffix } from '../textContext'

export interface AutocompleteTemplate {
    buildPrompts: (prefix: string, suffix: string) => AutocompletePrompt
    completionOptions: {
        stop?: string[]
        maxTokens?: number
        temperature?: number
    }
}

export const autocompleteTemplate: AutocompleteTemplate = {
    buildPrompts: buildAutocompletePrompt,
    completionOptions: {
        stop: ['\n', '[COMPLETE_HERE]'],
        maxTokens: DEFAULT_AUTOCOMPLETE_MAX_TOKENS,
        temperature: DEFAULT_AUTOCOMPLETE_TEMPERATURE,
    },
}

export function getAutocompleteTemplateForModel(_model: string): AutocompleteTemplate {
    return autocompleteTemplate
}