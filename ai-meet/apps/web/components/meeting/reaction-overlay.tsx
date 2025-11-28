"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

export interface Reaction {
    id: string
    emoji: string
    userId: string
}

interface ReactionOverlayProps {
    reactions: Reaction[]
}

export function ReactionOverlay({ reactions }: ReactionOverlayProps) {
    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-50">
            {reactions.map((reaction) => (
                <FloatingEmoji key={reaction.id} emoji={reaction.emoji} />
            ))}
        </div>
    )
}

function FloatingEmoji({ emoji }: { emoji: string }) {
    const [style, setStyle] = useState<React.CSSProperties>({
        left: `${Math.random() * 80 + 10}%`, // Random horizontal position (10-90%)
        bottom: '100px',
        opacity: 1,
        transform: 'translateY(0) scale(1)',
    })

    useEffect(() => {
        // Trigger animation frame
        requestAnimationFrame(() => {
            setStyle((prev) => ({
                ...prev,
                bottom: '80%', // Float up to 80% of height
                opacity: 0,
                transform: `translateY(0) scale(${1.5 + Math.random()}) rotate(${Math.random() * 45 - 22.5}deg)`,
                transition: 'all 2s ease-out',
            }))
        })
    }, [])

    return (
        <div
            className="absolute text-4xl select-none transition-all duration-1000 ease-out"
            style={style}
        >
            {emoji}
        </div>
    )
}
