export interface AutocompleteTemplate {
    /**
     * Template function or string to format the prompt.
     */
    template: string | ((prefix: string, suffix: string) => string)

    /**
     * Completion options specific to this template.
     */
    completionOptions?: {
        stop?: string[]
        maxTokens?: number
        temperature?: number
    }
}
