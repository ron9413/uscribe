import { standardSentenceTemplate } from './standardSentenceTemplate'
import type { AutocompleteTemplate } from './types'

export type { AutocompleteTemplate } from './types'
export { extractPrefixSuffix } from './textWindow'

export function getTemplateForModel(_model: string): AutocompleteTemplate {
    return standardSentenceTemplate
}
