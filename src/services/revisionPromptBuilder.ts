import { RevisionAction } from '../types'

function getRevisionInstruction(action: RevisionAction, customPrompt?: string): string {
    if (action === 'custom' && customPrompt?.trim()) {
        return customPrompt
    }
    return 'Revise:'
}

export function buildRevisionSystemPrompt(prefix: string, suffix: string): string {
    return `You are a text revision assistant.

You will revise text that is inserted between surrounding context.

Prefix (text before the selected text):
${prefix}

Suffix (text after the selected text):
${suffix}

Suggest revised text that fits cohesively between the prefix and suffix. Ensure punctuation, spacing, and capitalization are correct at the boundaries.

Return only the revised text.`
}

export function buildRevisionUserPrompt(
    action: RevisionAction,
    selectedText: string,
    customPrompt?: string,
): string {
    const instruction = getRevisionInstruction(action, customPrompt)
    return `${instruction}\n${selectedText}`
}
