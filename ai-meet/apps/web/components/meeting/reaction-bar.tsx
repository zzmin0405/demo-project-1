"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ReactionBarProps {
    onReaction: (emoji: string) => void
    className?: string
}

const REACTIONS = [
    { emoji: "👍", label: "Thumbs Up" },
    { emoji: "❤️", label: "Love" },
    { emoji: "😂", label: "Joy" },
    { emoji: "😮", label: "Wow" },
    { emoji: "😢", label: "Sad" },
    { emoji: "🎉", label: "Tada" },
]

export function ReactionBar({ onReaction, className }: ReactionBarProps) {
    return (
        <div className={cn(
            "flex items-center gap-2 p-2 rounded-full bg-background/80 backdrop-blur-md border shadow-lg animate-in slide-in-from-bottom-5 fade-in duration-300",
            className
        )}>
            {REACTIONS.map((reaction) => (
                <Button
                    key={reaction.label}
                    variant="ghost"
                    size="icon"
                    className="rounded-full hover:bg-secondary hover:scale-110 transition-all text-xl"
                    onClick={() => onReaction(reaction.emoji)}
                    title={reaction.label}
                >
                    {reaction.emoji}
                </Button>
            ))}
        </div>
    )
}
