import { useEffect, useState, useRef } from 'react'

interface InlineDiffPreviewProps {
    result: {
        original: string
        revised: string
        diff: any[]
    }
    onAccept: (editedText?: string) => void
    onReject: () => void
    isLoading: boolean
}

function InlineDiffPreview({
    result,
    onAccept,
    onReject,
    isLoading
}: InlineDiffPreviewProps) {
    const [editedText, setEditedText] = useState(result.revised)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        setEditedText(result.revised)
    }, [result.revised])

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = textareaRef.current.scrollHeight + "px"
        }
    }, [editedText])

    return (
        <div
            style={{
                position: 'relative',
                zIndex: 50,
            }}
        >
            {/* Suggested text - green highlight, editable, inline-style */}
            <div
                className="inline-block"
                style={{
                    backgroundColor: '#dcfce7',
                    color: '#166534',
                    padding: '2px 4px',
                }}
            >
                <textarea
                    ref={textareaRef}
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    className="bg-transparent border-none outline-none resize-none"
                    style={{
                        fontSize: 'inherit',
                        fontFamily: 'inherit',
                        lineHeight: 'inherit',
                        color: '#166534',
                        minWidth: '200px',
                    }}
                    disabled={isLoading}
                    rows={1}
                />
            </div>

            {/* Action buttons - inline next to suggestion */}
            <div className="inline-flex items-center gap-2 ml-2 text-xs">
                {isLoading && (
                    <span className="text-gray-500">Processing...</span>
                )}
                <button
                    onClick={() => onAccept(editedText)}
                    className="text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-blue-50"
                    disabled={isLoading}
                    type="button"
                >
                    Accept
                </button>
                <button
                    onClick={onReject}
                    className="text-gray-600 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100"
                    disabled={isLoading}
                    type="button"
                >
                    Reject
                </button>
            </div>
        </div>
    )
}

export default InlineDiffPreview
