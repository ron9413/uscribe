import { RevisionAction } from '../types'
import { buildRevisionSystemPrompt, buildRevisionUserPrompt } from './revisionPromptBuilder'

export interface RevisionTemplate {
    buildPrompts: (
        text: string,
        action: RevisionAction,
        customPrompt: string | undefined,
        prefix: string,
        suffix: string
    ) => {
        systemPrompt: string
        userPrompt: string
    }
    completionOptions?: {
        temperature?: number
        maxTokens?: number
    }
}

const sharedRevisionTemplate: RevisionTemplate = {
    buildPrompts: (
        text: string,
        action: RevisionAction,
        customPrompt: string | undefined,
        prefix: string,
        suffix: string,
    ) => {
        return {
            systemPrompt: buildRevisionSystemPrompt(prefix, suffix),
            userPrompt: buildRevisionUserPrompt(action, text, customPrompt),
        }
    },
    completionOptions: {
        temperature: 0.3,
        maxTokens: 2000,
    },
}

export function getRevisionTemplateForModel(_model: string): RevisionTemplate {
    return sharedRevisionTemplate
}

export function getRevisionPrompt (
    model: string,
    text: string,
    action: RevisionAction,
    prefix: string,
    suffix: string,
    customPrompt?: string
): {
    prompt: {
        systemPrompt: string
        userPrompt: string
    }
    template: RevisionTemplate
} {
    const template = getRevisionTemplateForModel(model)
    const prompt = template.buildPrompts(text, action, customPrompt, prefix, suffix)

    return { prompt, template }
}
