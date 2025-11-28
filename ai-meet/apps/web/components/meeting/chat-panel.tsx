import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Send } from 'lucide-react';
import Image from 'next/image';
import { cn } from "@/lib/utils";
import { useEffect, useRef } from 'react';

interface ChatMessage {
    userId: string;
    username: string;
    message: string;
    timestamp: string;
    avatar_url?: string;
}

interface ChatPanelProps {
    messages: ChatMessage[];
    currentUserId?: string | null;
    newMessage: string;
    onNewMessageChange: (value: string) => void;
    onSendMessage: (e?: React.FormEvent) => void;
    onClose: () => void;
}

export function ChatPanel({
    messages,
    currentUserId,
    newMessage,
    onNewMessageChange,
    onSendMessage,
    onClose
}: ChatPanelProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    return (
        <div className="flex flex-col h-full bg-card w-full shadow-xl transition-all duration-300">
            <div className="p-4 border-b flex justify-between items-center bg-secondary/20">
                <h3 className="font-bold text-lg">Chat</h3>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="w-4 h-4" />
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
                {messages.length === 0 && (
                    <div className="text-center text-muted-foreground text-sm py-10">
                        No messages yet. Start the conversation!
                    </div>
                )}
                {messages.map((msg, idx) => {
                    const isMe = msg.userId === currentUserId;
                    return (
                        <div key={idx} className={cn("flex gap-2", isMe ? "flex-row-reverse" : "flex-row")}>
                            <div className="flex-shrink-0">
                                {msg.avatar_url ? (
                                    <Image src={msg.avatar_url} alt={msg.username} width={32} height={32} className="rounded-full object-cover border border-border" />
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary border border-border">
                                        {msg.username?.[0]?.toUpperCase()}
                                    </div>
                                )}
                            </div>
                            <div className={cn(
                                "flex flex-col max-w-[80%]",
                                isMe ? "items-end" : "items-start"
                            )}>
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="text-xs font-semibold text-foreground">{msg.username}</span>
                                    <span className="text-[10px] text-muted-foreground">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div className={cn(
                                    "px-3 py-2 rounded-lg text-sm break-words shadow-sm",
                                    isMe
                                        ? "bg-blue-600 text-white rounded-tr-none"
                                        : "bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-gray-100 rounded-tl-none"
                                )}>
                                    {msg.message}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="p-4 border-t bg-secondary/10">
                <form onSubmit={onSendMessage} className="flex gap-2">
                    <Input
                        ref={inputRef}
                        value={newMessage}
                        onChange={(e) => onNewMessageChange(e.target.value)}
                        placeholder="Type a message..."
                        className="flex-1"
                    />
                    <Button
                        type="submit"
                        size="icon"
                        disabled={!newMessage.trim()}
                        onMouseDown={(e) => e.preventDefault()} // Prevent button from stealing focus
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                </form>
            </div>
        </div>
    );
}
