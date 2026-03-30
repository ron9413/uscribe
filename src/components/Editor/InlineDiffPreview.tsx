import { useEffect, useState } from 'react'

interface InlineDiffPreviewProps {
    result: {
        original: string
        revised: string
    }
    onAccept: (editedText?: string) => void
    onCancel: () => void
    onReject: () => void
    isLoading: boolean
}

function InlineDiffPreview({
    result,
    onAccept,
    onCancel,
    onReject,
    isLoading
}: InlineDiffPreviewProps) {
    const [editedText, setEditedText] = useState(result.revised)

    useEffect(() => {
        setEditedText(result.revised)
    }, [result.revised])

    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-lg p-3 min-w-[360px] max-w-[600px]">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Revision Preview
            </div>

            <div className="space-y-2">
                <div className="rounded-md border border-red-200 bg-red-50 p-2">
                    <div className="text-[11px] font-medium text-red-700 mb-1">Original</div>
                    <div
                        className="h-24 overflow-y-auto text-sm text-red-900 whitespace-pre-wrap break-words leading-relaxed"
                        aria-label="Original text"
                    >
                        {result.original}
                    </div>
                </div>

                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
                    <div className="text-[11px] font-medium text-emerald-700 mb-1">Suggested (editable)</div>
                    <textarea
                        value={editedText}
                        onChange={(e) => setEditedText(e.target.value)}
                        className="h-24 w-full overflow-y-auto bg-transparent border-none outline-none resize-none text-sm text-emerald-900 leading-relaxed"
                        aria-label="Suggested revised text"
                        style={{
                            fontFamily: 'inherit',
                            minWidth: '280px',
                        }}
                        disabled={isLoading}
                        rows={1}
                    />
                </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs">
                <div className="inline-flex items-center gap-2">
                    <button
                        onClick={() => onAccept(editedText)}
                        className="text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-blue-50 disabled:text-blue-300 disabled:hover:bg-transparent"
                        type="button"
                        disabled={isLoading}
                    >
                        Accept
                    </button>
                    <button
                        onClick={onReject}
                        className="text-gray-600 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 disabled:text-gray-300 disabled:hover:bg-transparent"
                        type="button"
                        aria-label="Reject revision"
                        disabled={isLoading}
                    >
                        Reject
                    </button>
                </div>

                {isLoading && (
                    <button
                        onClick={onCancel}
                        className="text-amber-700 hover:text-amber-800 px-2 py-1 rounded hover:bg-amber-50"
                        type="button"
                        aria-label="Cancel revision generation"
                    >
                        Cancel
                    </button>
                )}
            </div>
        </div>
    )
}

export default InlineDiffPreview