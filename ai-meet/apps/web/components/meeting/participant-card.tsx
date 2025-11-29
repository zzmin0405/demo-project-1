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
    onPin?: (userId: string) => void;
)
}

{/* Fallback Avatar */ }
{
    ((isLocal && (!localVideoOn || !localStream)) || (!isLocal && !participant.hasVideo)) && (
        <div className="absolute inset-0 flex items-center justify-center">
            {participant.avatar_url ? (
                <Image src={participant.avatar_url} alt={participant.username} width={120} height={120} className="rounded-full object-cover border-4 border-background/20" />
            ) : (
                <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-primary/20 flex items-center justify-center text-4xl font-bold text-primary">
                    {participant.username?.[0]?.toUpperCase()}
                </div>
            )}
        </div>
    )
}
            </div >

    {/* Name Tag & Status Icons */ }
    < div className = "absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs md:text-sm text-white font-medium backdrop-blur-sm flex items-center gap-2" >
        <span>
            {participant.username} {isLocal && "(You)"}
        </span>
{/* Mute Status Icon */ }
{
    (isLocal ? isMuted : participant.isMuted) ? (
        <MicOff className="w-3 h-3 text-red-400" />
    ) : (
        <Mic className="w-3 h-3 text-green-400" />
    )
}
            </div >

    {/* Hover Controls Overlay */ }
    < div className = "absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[1px]" >
        {!isLocal && (
                </Button >
            </>
        )}
            </div >
        </div >
    );
};
