import React, { useEffect, useRef, useState } from 'react';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Pin, PinOff, Radio } from "lucide-react";
import Image from "next/image";
import type { Reaction } from "@/components/meeting/reaction-overlay";

interface Participant {
    userId: string;
    username: string;
    hasVideo: boolean;
    isMuted?: boolean;
    canBroadcast?: boolean;
    avatar_url?: string;
}

interface ParticipantCardProps {
    participant: Participant;
    isLocal?: boolean;
    isPinned?: boolean;
    className?: string;
    localVideoOn?: boolean;
    localStream?: MediaStream | null;
    isMuted?: boolean;
    isSpeaking?: boolean;
    reactions?: Reaction[];
    speakerAction?: 'make' | 'revoke';
    speakerActionLabel?: string;
    onPin?: (userId: string) => void;
    onSpeakerAction?: (userId: string) => void;
    setLocalVideoRef?: (element: HTMLVideoElement | null) => void;
    onRemoteVideoRef?: (userId: string, element: HTMLVideoElement | null) => void;
}

export const ParticipantCard: React.FC<ParticipantCardProps> = ({
    participant,
    isLocal,
    isPinned,
    className,
    localVideoOn,
    localStream,
    isMuted,
    isSpeaking,
    reactions = [],
    speakerAction,
    speakerActionLabel,
    onPin,
    onSpeakerAction,
    setLocalVideoRef,
    onRemoteVideoRef
}) => {
    // console.log(`[ParticipantCard] Render ${participant.userId} isLocal=${isLocal} localVideoOn=${localVideoOn} hasVideo=${participant.hasVideo}`);

    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (isLocal && videoRef.current && localStream) {
            // console.log(`[ParticipantCard] Force attaching local stream`);
            videoRef.current.srcObject = localStream;
        }
    }, [isLocal, localStream]);

    // Handle remote video ref safely
    useEffect(() => {
        if (!isLocal && videoRef.current && onRemoteVideoRef) {
            // Ensure no local stream is attached
            videoRef.current.srcObject = null;
            onRemoteVideoRef(participant.userId, videoRef.current);
        }
    }, [isLocal, participant.userId, onRemoteVideoRef]);

    const handleLocalVideoRef = React.useCallback((el: HTMLVideoElement | null) => {
        if (setLocalVideoRef) setLocalVideoRef(el);
        (videoRef as any).current = el;
    }, [setLocalVideoRef]);

    const handleRemoteVideoRef = React.useCallback((el: HTMLVideoElement | null) => {
        (videoRef as any).current = el;
        if (onRemoteVideoRef && !isLocal) {
            onRemoteVideoRef(participant.userId, el);
        }
    }, [onRemoteVideoRef, isLocal, participant.userId]);

    return (
        <div className={cn(
            "relative group bg-muted rounded-lg overflow-hidden border border-border shadow-sm transition-all",
            isSpeaking && "ring-4 ring-green-500 border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]",
            className
        )}>
            {/* Video / Avatar Area */}
            <div className="w-full h-full flex items-center justify-center bg-black/90">
                {isLocal ? (
                    <video
                        key="local-video"
                        ref={handleLocalVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className={cn("w-full h-full object-contain", localVideoOn ? "visible" : "invisible")}
                    />
                ) : (
                    <video
                        key="remote-video"
                        ref={handleRemoteVideoRef}
                        autoPlay
                        playsInline
                        className={cn("w-full h-full object-contain", participant.hasVideo ? "visible" : "invisible")}
                    />
                )}

                {/* Fallback Avatar */}
                {((isLocal && (!localVideoOn || !localStream)) || (!isLocal && !participant.hasVideo)) && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        {participant.avatar_url ? (
                            <Image src={participant.avatar_url} alt={participant.username} width={120} height={120} className="rounded-full object-cover border-4 border-background/20" />
                        ) : (
                            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-primary/20 flex items-center justify-center text-4xl font-bold text-primary">
                                {participant.username?.[0]?.toUpperCase()}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Reactions anchored to this participant's camera/avatar */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
                {reactions.map((reaction) => (
                    <CardReaction key={reaction.id} emoji={reaction.emoji} />
                ))}
            </div>

            <div className="absolute top-2 left-2 z-30 flex items-center gap-2">
                {participant.canBroadcast && (
                    <div className="h-8 rounded-md bg-emerald-500/90 px-3 text-xs font-semibold text-white shadow-lg backdrop-blur-sm flex items-center gap-1.5">
                        <Radio className="h-3.5 w-3.5" />
                        화자
                    </div>
                )}
                {speakerAction && (
                    <Button
                        size="sm"
                        variant={speakerAction === 'revoke' ? 'destructive' : 'secondary'}
                        className={cn(
                            "h-8 rounded-md px-3 text-xs font-semibold shadow-lg",
                            speakerAction === 'make'
                                ? "bg-white/90 text-black hover:bg-white"
                                : "bg-red-500/90 text-white hover:bg-red-500"
                        )}
                        onClick={(event) => {
                            event.stopPropagation();
                            onSpeakerAction?.(participant.userId);
                        }}
                    >
                        {speakerActionLabel ?? (speakerAction === 'make' ? '화자 권한 주기' : '화자 권한 뺐기')}
                    </Button>
                )}
            </div>

            {/* Name Tag & Status Icons */}
            <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-md bg-black/65 px-2.5 py-1.5 text-xs md:text-sm text-white font-medium backdrop-blur-sm flex items-center gap-2">
                <span className="truncate">
                    {participant.username} {isLocal && "(You)"}
                </span>
                {/* Mute Status Icon */}
                {(isLocal ? isMuted : participant.isMuted) ? (
                    <MicOff className="w-3 h-3 text-red-400" />
                ) : (
                    <Mic className="w-3 h-3 text-green-400" />
                )}
            </div>

            {/* Hover Controls Overlay */}
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                {!isLocal && (
                    <Button
                        size="icon"
                        variant={isPinned ? "default" : "secondary"}
                        className="rounded-full w-8 h-8 bg-black/60 hover:bg-black/80 text-white border-0 backdrop-blur-sm shadow-md"
                        onClick={(event) => {
                            event.stopPropagation();
                            onPin?.(participant.userId);
                        }}
                        title={isPinned ? "Unpin" : "Pin"}
                    >
                        {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    </Button>
                )}
            </div>
        </div>
    );
};

function CardReaction({ emoji }: { emoji: string }) {
    const [style, setStyle] = useState<React.CSSProperties>({
        left: `${42 + Math.random() * 16}%`,
        bottom: '18%',
        opacity: 1,
        transform: 'translate(-50%, 0) scale(1)',
    });

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            setStyle({
                left: `${38 + Math.random() * 24}%`,
                bottom: '72%',
                opacity: 0,
                transform: `translate(-50%, 0) scale(${1.45 + Math.random() * 0.35}) rotate(${Math.random() * 24 - 12}deg)`,
                transition: 'bottom 1.8s ease-out, opacity 1.8s ease-out, transform 1.8s ease-out',
            });
        });

        return () => cancelAnimationFrame(frame);
    }, []);

    return (
        <div
            className="absolute text-4xl md:text-5xl select-none drop-shadow-[0_8px_18px_rgba(0,0,0,0.55)]"
            style={style}
        >
            {emoji}
        </div>
    );
}
