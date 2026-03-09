import { RevisionAction } from '../../types'
import { truncatePrefixSuffix } from '../textContext'
import { buildRevisionPrompt, type RevisionPrompt } from './promptBuilder'

export const DEFAULT_REVISION_MAX_TOKENS = 2000
export const DEFAULT_REVISION_TEMPERATURE = 0.3

export interface RevisionTemplate {
    buildPrompts: (
        text: string,
        action: RevisionAction,
        customPrompt?: string,
        prefix?: string,
        suffix?: string
    ) => RevisionPrompt
    revisionOptions?: {
        temperature?: number
        maxTokens?: number
    }
}

export const revisionTemplate: RevisionTemplate = {
    buildPrompts: (text, action, customPrompt, prefix = '', suffix = '') => {
        const { prefix: truncatedPrefix, suffix: truncatedSuffix } =
            truncatePrefixSuffix(prefix, suffix)
        return buildRevisionPrompt(
            action,
            text,
            truncatedPrefix,
            truncatedSuffix,
            customPrompt
        )
    },
    revisionOptions: {
        temperature: DEFAULT_REVISION_TEMPERATURE,
        maxTokens: DEFAULT_REVISION_MAX_TOKENS,
    },
}

export function getRevisionTemplateForModel(_model: string): RevisionTemplate {
    return revisionTemplate
}