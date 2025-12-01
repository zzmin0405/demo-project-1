import React, { useEffect, useRef } from 'react';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Video, VideoOff, Pin, PinOff, PhoneOff } from "lucide-react";
import Image from "next/image";

interface Participant {
    userId: string;
    username: string;
    hasVideo: boolean;
    isMuted?: boolean;
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
    onPin?: (userId: string) => void;
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
    onPin,
    setLocalVideoRef,
    onRemoteVideoRef
}) => {
    // console.log(`[ParticipantCard] Render ${participant.userId} isLocal=${isLocal} localVideoOn=${localVideoOn} hasVideo=${participant.hasVideo}`);

    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (isLocal && videoRef.current) {
            // console.log(`[ParticipantCard] Local Video Ref State: srcObject=${!!videoRef.current.srcObject}, paused=${videoRef.current.paused}, readyState=${videoRef.current.readyState}, style.display=${videoRef.current.style.display}`);
        }
    });

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

            {/* Name Tag & Status Icons */}
            <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs md:text-sm text-white font-medium backdrop-blur-sm flex items-center gap-2">
                <span>
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
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[1px]">
                {!isLocal && (
                    <>
                        <Button
                            size="icon"
                            variant={isPinned ? "default" : "secondary"}
                            className="rounded-full w-10 h-10"
                            onClick={() => onPin?.(participant.userId)}
                            title={isPinned ? "Unpin" : "Pin"}
                        >
                            {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                        </Button>
                        {/* Host controls placeholders */}
                        <Button size="icon" variant="destructive" className="rounded-full w-10 h-10" title="Mute (Host only)">
                            <MicOff className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="destructive" className="rounded-full w-10 h-10" title="Kick (Host only)">
                            <PhoneOff className="w-4 h-4" />
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
};
