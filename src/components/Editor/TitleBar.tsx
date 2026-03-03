import { useState, useEffect, useRef } from 'react'

interface TitleBarProps {
    title: string
    onTitleChange: (title: string) => void
    updatedAt: string
}

function TitleBar({ title, onTitleChange, updatedAt }: TitleBarProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [localTitle, setLocalTitle] = useState(title)
    const [cursorPosition, setCursorPosition] = useState<number | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const titleRef = useRef<HTMLHeadingElement>(null)

    useEffect(() => {
        setLocalTitle(title)
    }, [title])

    useEffect(() => {
        if (isEditing && inputRef.current && cursorPosition !== null) {
            inputRef.current.setSelectionRange(cursorPosition, cursorPosition)
            setCursorPosition(null)
        }
    }, [isEditing, cursorPosition])

    const handleBlur = () => {
        setIsEditing(false)
        if (localTitle.trim() !== title) {
            onTitleChange(localTitle.trim() || 'Untitled')
        }
    }

    const handleTitleClick = (e: React.MouseEvent<HTMLHeadingElement>) => {
        if (!titleRef.current) {
            setIsEditing(true)
            return
        }
    
        // Get the click position relative to the element
        const rect = titleRef.current.getBoundingClientRect()
        const clickX = e.clientX - rect.left

        // Create a temporary canvas to measure text width
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (!context) {
            setIsEditing(true)
            return
        }

        // Get the computed font style from the h1 element
        const computedStyle = window.getComputedStyle(titleRef.current)
        context.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`

        // Find the character position closest to the click
        let position = 0
        for (let i = 0; i <= title.length; i++) {
            const textWidth = context.measureText(title.substring(0, i)).width
            if (textWidth > clickX) {
                // Check if we're closer to the previous or current character
                const prevWidth = i > 0 ? context.measureText(title.substring(0, i - 1)).width : 0
                const distToCurrent = Math.abs(textWidth - clickX)
                const distToPrev = Math.abs(prevWidth - clickX)
                position = distToPrev < distToCurrent ? i - 1 : i
                break
            }
            position = i
        }

        setCursorPosition(position)
        setIsEditing(true)
    }

    const formatDate = (dateString: string) => {
        const date = new Date(dateString)
        const now = new Date()
        const diff = now.getTime() - date.getTime()
        const minutes = Math.floor(diff / 60000)
        const hours = Math.floor(diff / 3600000)
        const days = Math.floor(diff / 86400000)

        if (minutes < 1) return 'Just now'
        if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
        if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
        if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`

        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        })
    }

    return (
        <div className="border-b border-notes-border px-16 py-4 bg-white">
            {isEditing ? (
                <input
                    ref={inputRef}
                    type="text"
                    value={localTitle}
                    onChange={(e) => setLocalTitle(e.target.value)}
                    onBlur={handleBlur}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            handleBlur()
                        }
                    }}
                    className="text-2xl font-semibold w-full outline-none"
                    autoFocus
                />
            ) : (
                <h1
                    ref={titleRef}
                    className="text-2xl font-semibold cursor-text select-none"
                    onClick={handleTitleClick}
                >
                    {title}
                </h1>
            )}
            <p className="text-sm text-gray-500 mt-1">
                {formatDate(updatedAt)}
            </p>
        </div>
    )
}

export default TitleBar
