import { useEffect } from 'react'

interface ToastProps {
    message: string
    duration?: number
    onDismiss: () => void
}

export default function Toast({ message, duration = 2500, onDismiss }: ToastProps) {
    useEffect(() => {
        const id = window.setTimeout(onDismiss, duration)
        return () => window.clearTimeout(id)
    }, [duration, onDismiss])

    return (
        <div
            className="fixed bottom-6 left-1/2 -transform-x-1/2 z-50 px-4 py-2.5 rounded-lg bg-gray-800 text-gray-100 text-sm font-medium shadow-lg transition-opacity duration-200"
            role="status"
            aria-live="polite"
        >
            {message}
        </div>
    )
}
