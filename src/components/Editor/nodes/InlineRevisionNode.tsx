import { useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { Change } from 'diff'
import {
    DecoratorNode,
    EditorConfig,
    LexicalNode,
    NodeKey,
    SerializedLexicalNode,
    Spread,
    createCommand,
} from 'lexical'
import InlineDiffPreview from '../InlineDiffPreview'

export const ACCEPT_INLINE_REVISION_COMMAND = createCommand<{
    nodeKey: string
    editedText?: string
}>()
export const REJECT_INLINE_REVISION_COMMAND = createCommand<{ nodeKey: string }>()

export interface InlineRevisionRange {
    // Absolute offsets in the editor text stream; survives lexical key regeneration on reload.
    startIndex?: number
    endIndex?: number
    startOffset: number
    endOffset: number
    startKey: string
    endKey: string
}

export type SerializedInlineRevisionNode = Spread<
    {
        type: 'inline-revision'
        version: 1
        original: string
        revised: string
        diff: Change[]
        isLoading: boolean
        range: InlineRevisionRange
    },
    SerializedLexicalNode
>

function InlineRevisionPreview({
    nodeKey,
    original,
    revised,
    isLoading,
}: {
    nodeKey: string
    original: string
    revised: string
    isLoading: boolean
}) {
    const [editor] = useLexicalComposerContext()
    const [editedText, setEditedText] = useState(revised)

    useEffect(() => {
        setEditedText(revised)
    }, [revised])

    return (
        <InlineDiffPreview
            result={{ original, revised: editedText }}
            isLoading={isLoading}
            onAccept={(text) => {
                editor.dispatchCommand(ACCEPT_INLINE_REVISION_COMMAND, {
                    nodeKey,
                    editedText: text,
                })
            }}
            onReject={() => {
                editor.dispatchCommand(REJECT_INLINE_REVISION_COMMAND, { nodeKey })
            }}
        />
    )
}

export class InlineRevisionNode extends DecoratorNode<JSX.Element> {
    __original: string
    __revised: string
    __diff: Change[]
    __isLoading: boolean
    __range: InlineRevisionRange

    static getType(): string {
        return 'inline-revision'
    }

    static clone(node: InlineRevisionNode): InlineRevisionNode {
        return new InlineRevisionNode(
            node.__original,
            node.__revised,
            node.__diff,
            node.__isLoading,
            node.__range,
            node.__key
        )
    }

    static importJSON(serializedNode: SerializedInlineRevisionNode): InlineRevisionNode {
        return new InlineRevisionNode(
            serializedNode.original,
            serializedNode.revised,
            serializedNode.diff,
            serializedNode.isLoading,
            serializedNode.range
        )
    }

    constructor(
        original: string,
        revised: string,
        diff: Change[],
        isLoading: boolean,
        range: InlineRevisionRange,
        key?: NodeKey
    ) {
        super(key)
        this.__original = original
        this.__revised = revised
        this.__diff = diff
        this.__isLoading = isLoading
        this.__range = range
    }

    exportJSON(): SerializedInlineRevisionNode {
        return {
            type: 'inline-revision',
            version: 1,
            original: this.__original,
            revised: this.__revised,
            diff: this.__diff,
            isLoading: this.__isLoading,
            range: this.__range,
        }
    }

    createDOM(_config: EditorConfig): HTMLElement {
        const element = document.createElement('span')
        element.style.display = 'inline-block'
        element.style.verticalAlign = 'top'
        return element
    }

    updateDOM(): false {
        return false
    }

    setRevision(revised: string, diff: Change[]): void {
        const writable = this.getWritable()
        writable.__revised = revised
        writable.__diff = diff
    }

    setLoading(isLoading: boolean): void {
        const writable = this.getWritable()
        writable.__isLoading = isLoading
    }

    getOriginalText(): string {
        return this.getLatest().__original
    }

    getRevisedText(): string {
        return this.getLatest().__revised
    }

    getRange(): InlineRevisionRange {
        return this.getLatest().__range
    }

    decorate(): JSX.Element {
        return (
            <InlineRevisionPreview
                nodeKey={this.getKey()}
                original={this.__original}
                revised={this.__revised}
                isLoading={this.__isLoading}
            />
        )
    }
}

export function $createInlineRevisionNode(
    original: string,
    revised: string,
    diff: Change[],
    range: InlineRevisionRange,
    isLoading = false
): InlineRevisionNode {
    return new InlineRevisionNode(original, revised, diff, isLoading, range)
}

export function $isInlineRevisionNode(node: LexicalNode | null | undefined): node is InlineRevisionNode {
    return node instanceof InlineRevisionNode
}
