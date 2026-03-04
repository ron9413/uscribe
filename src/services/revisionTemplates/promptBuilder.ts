import { RevisionAction } from '../../types'

function getRevisionInstruction(action: RevisionAction, customPrompt?: string): string {
    if (action === 'custom' && customPrompt?.trim()) {
        return customPrompt
    }
    return 'Revise:'
}

export interface RevisionPrompt {
    systemPrompt: string
    userPrompt: string
}

export function buildRevisionPrompt(
    action: RevisionAction,
    selectedText: string,
    prefix: string,
    suffix: string,
    customPrompt?: string
): RevisionPrompt {
    const instruction = getRevisionInstruction(action, customPrompt)
    return {
        systemPrompt: `You are a text revision assistant.

You will revise text that is inserted between the surrounding context.

Prefix (text before the selected text):
${prefix}

Suffix (text after the selected text):
${suffix}

Suggest revised text that fits cohesively between the prefix and suffix. Ensure punctuation, spacing, and capitalization are correct at the boundaries.

Return only the revised text.`,
        userPrompt: `${instruction}\n\n${selectedText}`,
    }
}
