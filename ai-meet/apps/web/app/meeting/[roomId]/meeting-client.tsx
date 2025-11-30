'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { useSession } from "next-auth/react";
import Image from 'next/image';
import { Button } from "@/components/ui/button";
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff,
  MoreHorizontal, LayoutGrid, Maximize, Pin, PinOff,
  Users, MessageSquare, Settings, X, Send, ChevronUp, ChevronDown, Edit2, Trash2
} from 'lucide-react';
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChatPanel } from "@/components/meeting/chat-panel";
import { ParticipantCard } from "@/components/meeting/participant-card";
import { ReactionBar } from "@/components/meeting/reaction-bar";
import { ReactionOverlay, Reaction } from "@/components/meeting/reaction-overlay";

interface Participant {
  userId: string;
  username: string;
  hasVideo: boolean;
  isMuted: boolean;
  avatar_url?: string;
}

type LayoutMode = 'speaker' | 'grid';

export default function MeetingClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const currentUserId = session?.user?.id || session?.user?.email || 'anonymous';
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localVideoOn, setLocalVideoOn] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string | null>(null);
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [availableAudioInputDevices, setAvailableAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState<string | null>(null);
  const [availableAudioOutputDevices, setAvailableAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [micVolume, setMicVolume] = useState(1.0); // Local Mic Gain (0.0 to 3.0)

  const [meetingTitle, setMeetingTitle] = useState("Meeting Room");
  const [isHost, setIsHost] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState("");

  // Reaction State
  const [reactions, setReactions] = useState<Reaction[]>([]);

  // UI State
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('speaker');


  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showParticipantsPanel, setShowParticipantsPanel] = useState(false);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const socketRef = useRef<Socket | null>(null);

  // Chat State
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ userId: string; username: string; message: string; timestamp: string; avatar_url?: string }[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const remoteVideoRefs = useRef<{ [userId: string]: HTMLVideoElement | null }>({});
  const socketIdToUserIdMap = useRef<{ [socketId: string]: string }>({});
  const userIdToSocketIdMap = useRef<{ [userId: string]: string }>({});
  const isInitialized = useRef(false);

  // Audio Processing Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const mediaSourcesRef = useRef<{ [socketId: string]: MediaSource }>({});
  const sourceBuffersRef = useRef<{ [socketId: string]: SourceBuffer }>({});
  const chunkQueueRef = useRef<{ [socketId: string]: Blob[] }>({});

  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const [showEndCallModal, setShowEndCallModal] = useState(false);
  const [showMorePanel, setShowMorePanel] = useState(false);
  const [exitImmediately, setExitImmediately] = useState(false);

  // Load initial settings from sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedSettings = sessionStorage.getItem(`meeting-settings-${roomId}`);
      if (storedSettings) {
        try {
          const settings = JSON.parse(storedSettings);
          if (settings.joinMuted !== undefined) setIsMuted(settings.joinMuted);
          // If joinVideoOff is true, localVideoOn should be false.
          // If joinVideoOff is false, localVideoOn should be true.
          if (settings.joinVideoOff !== undefined) setLocalVideoOn(!settings.joinVideoOff);
        } catch (e) {
          console.error("Failed to parse meeting settings", e);
        }
      } else {
        // Default behavior if no settings found (e.g. direct link join)
        // Maybe default to Muted=true, Video=false for safety?
        // Current defaults are Muted=true, Video=false.
      }
    }
  }, [roomId]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, showChatPanel]);

  // ... (existing useEffects)

  // This socket.on listener needs to be inside an useEffect or a function called from useEffect
  // For now, I'll assume it's part of the socket initialization logic within useEffect.
  // If it's meant to be a global listener, it should be handled differently.
  // For the purpose of this edit, I'm leaving it as is, assuming it's a placeholder.
  // socket.on('chat-message', (data: { userId: string; username: string; message: string; timestamp: string; avatar_url?: string }) => {
  //   setChatMessages(prev => [...prev, data]);
  // });

  // ... (existing socket listeners)





  useEffect(() => {
    const savedSetting = localStorage.getItem('exitImmediately') === 'true';
    setExitImmediately(savedSetting);
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user) {
      console.log('Client: No user found, redirecting to login.');
      router.push('/login');
      return;
    }

    if (isInitialized.current) return;
    isInitialized.current = true;

    const initialize = async () => {
      console.log('Client: Initializing...');

      const currentUserId = (session.user as any).id || session.user?.email || 'unknown';
      console.log('Client: currentUser set to', currentUserId);

      const username = session.user?.name || session.user?.email || 'Anonymous';
      // userProfile state removed, using session directly

      try {
        console.log('Client: Enumerating media devices...');
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAvailableVideoDevices(devices.filter(device => device.kind === 'videoinput'));
        setAvailableAudioInputDevices(devices.filter(device => device.kind === 'audioinput'));
        setAvailableAudioOutputDevices(devices.filter(device => device.kind === 'audiooutput'));
      } catch (err) {
        console.error('Error enumerating devices:', err);
      }

      // Initialize Socket.IO
      const websocketUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'http://localhost:3001';
      console.log('Client: Connecting to WebSocket at', websocketUrl);

      socketRef.current = io(websocketUrl, {
        transports: ['websocket', 'polling'], // Try websocket first, then polling
        auth: {
          token: currentUserId, // Use actual userId as token for SupabaseAuthGuard
          userId: currentUserId
        },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        timeout: 20000,
        autoConnect: false // We will call connect() manually
      });

      const socket = socketRef.current;

      socket.on('connect_error', (err) => {
        console.error(`[SocketDebug] Connection Error: ${err.message}`, err);
      });

      socket.on('connect_timeout', (timeout) => {
        console.error(`[SocketDebug] Connection Timeout: ${timeout}`);
      });

      socket.on('error', (err) => {
        console.error(`[SocketDebug] Generic Error:`, err);
      });

      socket.on('connect', () => {
        console.log('Client: Connected to WebSocket server with socketId:', socket.id);
        socket.emit('join-room', {
          roomId,
          username,
          avatar_url: session.user?.image,
          hasVideo: false, // Will be updated after media init
          isMuted: true // Will be updated after media init
        });

        // Initialize media stream after joining (or in parallel)
        // We need to read the settings again or pass them. 
        // Since we are inside initialize, we can read from sessionStorage if needed, 
        // but it's better to rely on the state that was set by the first useEffect.
        // However, state updates might not be reflected yet if this runs immediately.
        // Let's read from sessionStorage directly here for safety.
        let initialVideoOn = false;
        let initialMuted = true;

        if (typeof window !== 'undefined') {
          const storedSettings = sessionStorage.getItem(`meeting-settings-${roomId}`);
          if (storedSettings) {
            const settings = JSON.parse(storedSettings);
            if (settings.joinVideoOff !== undefined) initialVideoOn = !settings.joinVideoOff;
            if (settings.joinMuted !== undefined) initialMuted = settings.joinMuted;
          }
        }

        initializeMediaStream(initialVideoOn, initialMuted, true); // isInitial = true

      });

      socket.on('room-state', async (data: { participants: (Participant & { socketId: string })[], title?: string, hostId?: string }) => {
        console.log('Client: room-state received', data);
        const filteredParticipants = data.participants.filter(p => p.userId !== currentUserId);

        if (data.title) setMeetingTitle(data.title);
        if (data.hostId && data.hostId === currentUserId) {
          setIsHost(true);
          console.log('Client: You are the host.');
        }

        // Populate maps immediately
        data.participants.forEach(p => {
          if (p.userId !== currentUserId) {
            socketIdToUserIdMap.current[p.socketId] = p.userId;
            userIdToSocketIdMap.current[p.userId] = p.socketId;
          }
        });

        setParticipants(filteredParticipants);
      });

      socket.on('user-joined', async (data: Participant & { socketId: string }) => {
        console.log(`Client: New user ${data.username} joined with socketId ${data.socketId}.`);
        if (data.userId === currentUserId) return;

        // Cleanup if user already exists (Ghost/Re-join)
        const oldSocketId = userIdToSocketIdMap.current[data.userId];
        if (oldSocketId) {
          console.log(`[UserJoined] Cleaning up stale resources for ${data.userId} (Old Socket: ${oldSocketId})`);
          cleanupMediaSource(oldSocketId);
          delete socketIdToUserIdMap.current[oldSocketId];
        }

        const newParticipant = { ...data };

        // Populate maps immediately
        socketIdToUserIdMap.current[data.socketId] = data.userId;
        userIdToSocketIdMap.current[data.userId] = data.socketId;

        setParticipants(prev => {
          // Remove existing entry for this userId to prevent duplicates
          const filtered = prev.filter(p => p.userId !== data.userId);
          return [...filtered, newParticipant];
        });

        // Restart MediaRecorder to send a fresh Init Segment (Keyframe) to the new user
        if (localStreamRef.current && localVideoOn) {
          console.log(`[UserJoined] Restarting MediaRecorder to send fresh Init Segment to ${data.username}`);
          setupMediaRecorder(localStreamRef.current);
        }
      });

      socket.on('user-left', (data: { userId: string }) => {
        console.log(`Client: User ${data.userId} left`);
        const socketId = userIdToSocketIdMap.current[data.userId];
        if (socketId) {
          cleanupMediaSource(socketId);
          delete socketIdToUserIdMap.current[socketId];
          delete userIdToSocketIdMap.current[data.userId];
        }
        setParticipants(prev => prev.filter(p => p.userId !== data.userId));
      });

      socket.on('media-chunk', async (data: { socketId: string, userId?: string, chunk: ArrayBuffer | any, mimeType?: string }) => {
        const { socketId, chunk, mimeType = 'video/webm; codecs="vp8, opus"' } = data;
        const userId = data.userId;
        console.log(`[MediaChunk] Received from ${socketId} (User: ${userId}), size: ${chunk.byteLength || chunk.length}`);
        const blob = new Blob([chunk], { type: mimeType });

        // STRICT IDENTITY CHECK: Only use userId from payload.
        // If the server didn't send a userId, we cannot trust this chunk.

        if (!userId) {
          // console.warn(`[MediaChunk] Dropping chunk from ${socketId} (No userId in payload)`);
          return;
        }

        if (userId === currentUserId) {
          // console.warn(`[MediaChunk] Ignored loopback chunk from self (socketId: ${socketId})`);
          return;
        }

        // Update map for reference, but rely on payload userId
        socketIdToUserIdMap.current[socketId] = userId;
        userIdToSocketIdMap.current[userId] = socketId;

        if (!mediaSourcesRef.current[socketId] || mediaSourcesRef.current[socketId].readyState === 'closed') {
          if (mediaSourcesRef.current[socketId]) {
            console.log(`[MediaChunk] MediaSource for ${socketId} is closed, recreating...`);
            cleanupMediaSource(socketId);
          }
          setupMediaSource(userId, socketId, mimeType);
        }

        // Re-check loopback for existing sources (Safety)
        if (userId === currentUserId) return;

        const sourceBuffer = sourceBuffersRef.current[socketId];
        const mediaSource = mediaSourcesRef.current[socketId];

        // Always queue if sourceBuffer doesn't exist yet
        if (!sourceBuffer) {
          if (!chunkQueueRef.current[socketId]) {
            chunkQueueRef.current[socketId] = [];
          }
          chunkQueueRef.current[socketId].push(blob);
          return;
        }

        if (!sourceBuffer.updating && mediaSource && mediaSource.readyState === 'open') {
          try {
            sourceBuffer.appendBuffer(await blob.arrayBuffer());
          } catch (e) {
            if (e instanceof DOMException && e.name === 'InvalidStateError') {
              console.warn(`Ignored InvalidStateError for ${socketId} (likely cleanup race condition)`);
            } else {
              console.error(`Error appending buffer for ${socketId}`, e);
            }
          }
        } else {
          if (!chunkQueueRef.current[socketId]) {
            chunkQueueRef.current[socketId] = [];
          }
          chunkQueueRef.current[socketId].push(blob);
        }
      });

      socket.on('mic-state-changed', (data: { userId: string; isMuted: boolean }) => {
        setParticipants(prev => prev.map(p => p.userId === data.userId ? { ...p, isMuted: data.isMuted } : p));
      });

      socket.on('camera-state-changed', (data: { userId: string; hasVideo: boolean }) => {
        console.log(`[Client] Camera state changed for userId=${data.userId}, hasVideo=${data.hasVideo}, currentUserId=${currentUserId}`);
        console.log(`[Client] Current participants:`, participants.map(p => ({ userId: p.userId, username: p.username, hasVideo: p.hasVideo })));
        setParticipants(prev => {
          const updated = prev.map(p => p.userId === data.userId ? { ...p, hasVideo: data.hasVideo } : p);
          console.log(`[Client] Updated participants:`, updated.map(p => ({ userId: p.userId, username: p.username, hasVideo: p.hasVideo })));
          return updated;
        });
      });

      socket.on('chat-message', (data: { userId: string; username: string; message: string; timestamp: string; avatar_url?: string }) => {
        setChatMessages(prev => [...prev, data]);
      });

      socket.on('meeting-title-updated', (data: { title: string }) => {
        setMeetingTitle(data.title);
      });

      socket.on('reaction-received', (data: { userId: string; emoji: string }) => {
        const newReaction: Reaction = {
          id: Math.random().toString(36).substr(2, 9),
          emoji: data.emoji,
          userId: data.userId
        };
        setReactions(prev => [...prev, newReaction]);

        // Cleanup after animation (2s)
        setTimeout(() => {
          setReactions(prev => prev.filter(r => r.id !== newReaction.id));
        }, 2000);
      });

      socket.on('chat-error', (data: { message: string }) => {
        console.error('[ChatDebug] Chat error received:', data.message);
        if (data.message.includes('Room not found') || data.message.includes('Participant not found')) {
          console.log('[ChatDebug] Room/Participant missing on server. Attempting to re-join...');
          socket.emit('join-room', {
            roomId,
            username,
            avatar_url: session.user?.image,
            hasVideo: localVideoOn,
            isMuted: isMuted
          });
          // Optional: Retry sending the message after a short delay?
          // For now, just let the user retry or rely on the next message.
        } else {
          alert(`채팅 전송 실패: ${data.message}`);
        }
      });

      socket.on('disconnect', (reason) => {
        console.log('Client: Disconnected from WebSocket server', reason);
      });
      socket.on('connect_error', (error) => {
        console.error('Client: WebSocket connection error', error);
      });

      socket.on('error', (data: { message: string }) => {
        console.error('Client: Socket error:', data.message);
        alert(data.message);
        router.push('/');
      });

      console.log('Client: Calling socket.connect()...');
      socket.connect();
    };

    initialize();

    return () => {
      isInitialized.current = false;
      if (socketRef.current) {
        console.log('Client: Disconnecting socket on cleanup');
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      // Cleanup media sources
      Object.keys(mediaSourcesRef.current).forEach(socketId => {
        cleanupMediaSource(socketId);
      });

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [roomId, status, currentUserId]);

  // Handle browser tab close / refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Use Beacon or Fetch with keepalive for reliable exit
      fetch(`/api/meeting/${roomId}/leave`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' }
      });

      socketRef.current?.disconnect();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Also trigger on component unmount (client-side navigation)
      handleBeforeUnload();
    };
  }, [roomId]);


  useEffect(() => {
    const setAudioOutput = async () => {
      if (selectedAudioOutputDeviceId) {
        Object.values(remoteVideoRefs.current).forEach(videoElement => {
          if (videoElement && typeof videoElement.setSinkId === 'function') {
            try {
              videoElement.setSinkId(selectedAudioOutputDeviceId);
            } catch (error) {
              console.error('Error setting audio output:', error);
            }
          }
        });
      }
    };
    setAudioOutput();
  }, [selectedAudioOutputDeviceId]);

  useEffect(() => {
    Object.values(remoteVideoRefs.current).forEach(videoElement => {
      if (videoElement) {
        videoElement.volume = volume;
      }
    });
  }, [volume, participants]);

  // Update Mic Gain when micVolume changes
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = micVolume;
    }
  }, [micVolume]);

  // Use callback ref to set initial ref
  const setLocalVideoRef = (element: HTMLVideoElement | null) => {
    localVideoRef.current = element;
    if (element && localStream) {
      console.log('[Callback Ref] Setting srcObject...');
      element.srcObject = localStream;
      console.log('[Callback Ref] srcObject set successfully');
    }
  };

  // Also use useEffect to update when localStream changes
  useEffect(() => {
    console.log('[useEffect srcObject] Triggered. localStream:', !!localStream, 'localVideoRef.current:', !!localVideoRef.current, 'localVideoOn:', localVideoOn);
    if (localStream && localVideoRef.current) {
      console.log('[useEffect srcObject] Setting srcObject...');
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.muted = true;
      console.log('[useEffect srcObject] srcObject set successfully');
    }
  }, [localStream, localVideoOn]);

  const setupMediaRecorder = (stream: MediaStream) => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
    if (socketRef.current && stream) {
      const hasVideo = stream.getVideoTracks().length > 0;
      let mimeType = 'video/webm; codecs=vp8,opus';

      if (hasVideo) {
        const possibleTypes = [
          'video/webm; codecs=vp8,opus',
          'video/webm; codecs=vp9,opus',
          'video/webm; codecs=h264,opus',
          'video/mp4; codecs=h264,aac',
        ];
        for (const type of possibleTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            mimeType = type;
            break;
          }
        }
      } else {
        mimeType = 'audio/webm; codecs=opus';
      }

      console.log(`Client: Setting up MediaRecorder with mimeType: ${mimeType}`);

      const options = { mimeType };
      try {
        const mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (event) => {
          // console.log(`[MediaRecorder] ondataavailable triggered, data size: ${event.data?.size || 0}`);
          if (event.data && event.data.size > 0 && socketRef.current) {
            // console.log(`[MediaRecorder] Emitting media-chunk, size: ${event.data.size}, mimeType: ${mimeType}`);
            socketRef.current.emit('media-chunk', { chunk: event.data, mimeType });
          } else {
            // console.warn(`[MediaRecorder] Skipping empty chunk or no socket. Data size: ${event.data?.size}, Socket: ${!!socketRef.current}`);
          }
        };
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.start(100); // 100ms for smoother video
        console.log('Client: MediaRecorder started with 100ms intervals');
      } catch (e) {
        console.error('MediaRecorder setup failed:', e);
      }
    }
  };

  const setupMediaSource = (userId: string, socketId: string, mimeType: string = 'video/webm; codecs="vp8, opus"') => {
    if (mediaSourcesRef.current[socketId] || !remoteVideoRefs.current[userId]) {
      return;
    }
    console.log(`Setting up MediaSource for userId: ${userId}, socketId: ${socketId} with mimeType: ${mimeType}`);
    const mediaSource = new MediaSource();
    mediaSourcesRef.current[socketId] = mediaSource;
    const videoElement = remoteVideoRefs.current[userId];

    if (videoElement) {
      videoElement.src = URL.createObjectURL(mediaSource);
      videoElement.onloadedmetadata = () => videoElement.play().catch(e => console.error("Autoplay failed", e));
    }

    mediaSource.addEventListener('sourceopen', async () => {
      console.log(`MediaSource opened for ${socketId}`);
      try {
        if (!MediaSource.isTypeSupported(mimeType)) {
          console.error(`${mimeType} is not supported`);
          return;
        }
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        sourceBuffersRef.current[socketId] = sourceBuffer;

        sourceBuffer.addEventListener('updateend', async () => {
          // Prune old buffer data to prevent memory overflow
          if (sourceBuffer.buffered.length > 0 && !sourceBuffer.updating) {
            const userId = socketIdToUserIdMap.current[socketId];
            const videoElement = userId ? remoteVideoRefs.current[userId] : null;
            const currentTime = videoElement?.currentTime || 0;
            const bufferStart = sourceBuffer.buffered.start(0);
            const bufferEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);

            // Keep only last 20 seconds of buffer (reduced from 30 to prevent QuotaExceeded)
            if (currentTime - bufferStart > 20) {
              try {
                const removeEnd = Math.max(bufferStart, currentTime - 20);
                sourceBuffer.remove(bufferStart, removeEnd);
                console.log(`[Buffer] Pruned old data for ${socketId}: ${bufferStart.toFixed(2)}s to ${removeEnd.toFixed(2)}s`);
                return; // Wait for next updateend to process queue
              } catch (e) {
                console.warn(`[Buffer] Failed to prune for ${socketId}`, e);
              }
            }
          }

          // Process queued chunks
          if (chunkQueueRef.current[socketId]?.length > 0 && !sourceBuffer.updating && mediaSource.readyState === 'open') {
            const nextChunk = chunkQueueRef.current[socketId].shift();
            if (nextChunk) {
              try {
                sourceBuffer.appendBuffer(await nextChunk.arrayBuffer());
              } catch (e) {
                if (e instanceof DOMException && e.name === 'InvalidStateError') {
                  console.warn(`Ignored InvalidStateError in queue for ${socketId}`);
                } else {
                  console.error(`Error appending queued buffer for ${socketId}`, e);
                }
              }
            }
          }
        });

        // Trigger initial queue processing
        if (chunkQueueRef.current[socketId]?.length > 0 && !sourceBuffer.updating && mediaSource.readyState === 'open') {
          const nextChunk = chunkQueueRef.current[socketId].shift();
          if (nextChunk) {
            try {
              sourceBuffer.appendBuffer(await nextChunk.arrayBuffer());
            } catch (e) {
              console.error(`Error appending initial queued buffer for ${socketId}`, e);
            }
          }
        }
      } catch (e) {
        console.error('Error adding source buffer:', e);
      }
    });
  };

  const cleanupMediaSource = (socketId: string) => {
    console.log(`Cleaning up MediaSource for ${socketId}`);
    const mediaSource = mediaSourcesRef.current[socketId];
    if (mediaSource && mediaSource.readyState === 'open') {
      try {
        mediaSource.endOfStream();
      } catch (e) {
        console.error(`Error ending stream for ${socketId}`, e);
      }
    }
    const userId = socketIdToUserIdMap.current[socketId];
    if (userId && remoteVideoRefs.current[userId]) {
      const videoEl = remoteVideoRefs.current[userId];
      if (videoEl) {
        const src = videoEl.src;
        if (src && src.startsWith('blob:')) {
          URL.revokeObjectURL(src);
        }
        videoEl.src = '';
        videoEl.removeAttribute('src');
        videoEl.load();
      }
    }
    delete mediaSourcesRef.current[socketId];
    delete sourceBuffersRef.current[socketId];
    delete chunkQueueRef.current[socketId];
  };



  // Effect to set up MediaSource for participants when they are added and video elements are ready
  // REMOVED: Proactive setup is removed to allow socket.on('media-chunk') to determine the correct mimeType.
  /*
  useEffect(() => {
    participants.forEach(p => {
      const socketId = userIdToSocketIdMap.current[p.userId];
      if (socketId && !mediaSourcesRef.current[socketId] && remoteVideoRefs.current[p.userId]) {
        setupMediaSource(p.userId, socketId);
      }
    });
  }, [participants]);
  */

  const initializeMediaStream = async (initialVideoOn: boolean = false, initialMuted: boolean = true, isInitial: boolean = false) => {
    try {
      console.log(`Client: Initializing media stream (Always request audio+video, Initial video: ${initialVideoOn}, Initial muted: ${initialMuted})...`);
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setAvailableVideoDevices(videoDevices);
      setAvailableAudioInputDevices(devices.filter(device => device.kind === 'audioinput'));
      setAvailableAudioOutputDevices(devices.filter(device => device.kind === 'audiooutput'));

      // Always request both video and audio
      const videoConstraint: boolean | MediaTrackConstraints = selectedVideoDeviceId
        ? { deviceId: { exact: selectedVideoDeviceId } }
        : true;

      const audioConstraint: boolean | MediaTrackConstraints = selectedAudioInputDeviceId
        ? {
          deviceId: { exact: selectedAudioInputDeviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
        : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: audioConstraint
      });

      // Set initial video track state based on user preference
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = initialVideoOn;
      }

      // --- Audio Processing for Volume Control ---
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const gainNode = audioContext.createGain();
      const destination = audioContext.createMediaStreamDestination();

      // Set initial gain based on mute preference
      gainNode.gain.value = initialMuted ? 0 : micVolume;

      source.connect(gainNode);
      gainNode.connect(destination);

      audioContextRef.current = audioContext;
      gainNodeRef.current = gainNode;
      audioSourceRef.current = source;
      audioDestinationRef.current = destination;

      // Create a mixed stream for MediaRecorder (ALWAYS includes both audio and video)
      const processedAudioTrack = destination.stream.getAudioTracks()[0];
      const mixedStream = new MediaStream([
        ...stream.getVideoTracks(),
        processedAudioTrack
      ]);
      // -------------------------------------------

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      setLocalStream(stream);
      localStreamRef.current = stream;
      setLocalVideoOn(initialVideoOn);
      setIsMuted(initialMuted);
      console.log('Client: Media stream initialized (always-on mode).');

      setupMediaRecorder(mixedStream);

      // Emit initial camera state
      socketRef.current?.emit('camera-state-changed', {
        roomId,
        userId: session?.user?.email,
        hasVideo: initialVideoOn
      });

      // Emit initial mic state
      socketRef.current?.emit('mic-state-changed', {
        roomId,
        userId: session?.user?.email,
        isMuted: initialMuted
      });

    } catch (err) {
      console.error('Error accessing media devices:', err);

      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError') {
          alert('카메라/마이크 권한이 거부되었습니다. 브라우저 주소창의 자물쇠 아이콘을 클릭하여 권한을 허용해주세요.');
          // Disconnect and go back to home
          socketRef.current?.disconnect();
          router.push('/');
        } else if (err.name === 'NotReadableError') {
          if (!isInitial) alert('카메라 하드웨어 오류: 장치가 응답하지 않습니다. (잠시 후 다시 시도하거나 컴퓨터를 재부팅해주세요)');
        } else if (err.name === 'NotFoundError') {
          alert('카메라/마이크를 찾을 수 없습니다. 장치가 올바르게 연결되었는지 확인해주세요.');
        } else {
          if (!isInitial) alert(`미디어 장치 오류: ${err.message}`);
        }
      } else {
        if (!isInitial) alert('미디어 장치에 접근할 수 없습니다. 알 수 없는 오류가 발생했습니다.');
      }
    }
  };

  const toggleCamera = () => {
    console.log('[toggleCamera] Called');
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!videoTrack) {
      console.warn('[toggleCamera] No video track available. Media stream not initialized.');
      return;
    }

    console.log(`[toggleCamera] Current enabled: ${videoTrack.enabled}, localVideoOn: ${localVideoOn}`);
    videoTrack.enabled = !videoTrack.enabled;
    setLocalVideoOn(videoTrack.enabled);
    console.log(`[toggleCamera] New enabled: ${videoTrack.enabled}, will set localVideoOn to: ${videoTrack.enabled}`);

    // Restart MediaRecorder if turning video ON to send a fresh Init Segment
    if (videoTrack.enabled && localStreamRef.current) {
      console.log('[toggleCamera] Restarting MediaRecorder to send fresh Init Segment...');
      setupMediaRecorder(localStreamRef.current);
    }

    socketRef.current?.emit('camera-state-changed', {
      roomId,
      userId: currentUserId,
      hasVideo: videoTrack.enabled,
    });
    console.log(`[toggleCamera] Emitted camera-state-changed: roomId=${roomId}, userId=${currentUserId}, hasVideo=${videoTrack.enabled}`);
    console.log(`[toggleCamera] Emitted camera-state-changed for ${currentUserId}: ${videoTrack.enabled}`);
  };

  const toggleMute = () => {
    if (!gainNodeRef.current) {
      console.warn('GainNode not available. Media stream not initialized.');
      return;
    }

    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    gainNodeRef.current.gain.value = newMutedState ? 0 : micVolume;

    socketRef.current?.emit('mic-state-changed', {
      roomId,
      userId: currentUserId,
      isMuted: newMutedState
    });
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setIsLinkCopied(true);
    setTimeout(() => {
      setIsLinkCopied(false);
    }, 2000);
  };



  const leaveRoom = () => {
    console.log('Client: Leaving room');
    mediaRecorderRef.current?.stop();
    localStreamRef.current?.getTracks().forEach(track => track.stop());

    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    // Explicitly notify server before disconnecting and wait for Ack
    if (socketRef.current?.connected) {
      const timeout = setTimeout(() => {
        console.log('Client: Leave Ack timed out, forcing disconnect');
        socketRef.current?.disconnect();
        router.push('/');
      }, 500); // Wait max 500ms

      socketRef.current.emit('leave-room', {}, () => {
        console.log('Client: Leave Ack received');
        clearTimeout(timeout);
        socketRef.current?.disconnect();
        router.push('/');
      });
    } else {
      // If already disconnected, just go home
      router.push('/');
    }
  };

  const handleEndCallClick = () => {
    if (exitImmediately) {
      leaveRoom();
    } else {
      setShowEndCallModal(true);
    }
  };

  const handleExitImmediatelyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.checked;
    setExitImmediately(newValue);
    localStorage.setItem('exitImmediately', String(newValue));
  };

  // --- Chat Logic ---
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, showChatPanel]);



  const sendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    console.log('[ChatDebug] sendMessage called. Message:', newMessage);

    if (!newMessage.trim()) {
      console.log('[ChatDebug] Message is empty');
      return;
    }

    if (!socketRef.current) {
      console.error('[ChatDebug] Socket not connected');
      return;
    }

    if (!socketRef.current.connected) {
      console.error('[ChatDebug] Socket instance exists but is disconnected');
      alert('서버와 연결이 끊겨있습니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    console.log('[ChatDebug] Emitting chat-message to room:', roomId);
    socketRef.current.emit('chat-message', {
      roomId,
      message: newMessage
    });
    setNewMessage('');
  };

  const handleTitleUpdate = () => {
    if (!tempTitle.trim() || tempTitle === meetingTitle) {
      setIsEditingTitle(false);
      return;
    }
    socketRef.current?.emit('update-meeting-title', { roomId, title: tempTitle });
    setIsEditingTitle(false);
  };

  const handleSendReaction = (emoji: string) => {
    socketRef.current?.emit('send-reaction', { roomId, emoji });
    // Optimistically show reaction for self? 
    // The server broadcasts to everyone including sender, so we can wait for that.
    // Or we can show it immediately for better responsiveness.
    // Let's rely on server broadcast for consistency for now.
  };

  // --- UI Components ---

  // --- Render Logic ---

  // --- Render Logic ---

  const pinnedParticipant = participants.find(p => p.userId === pinnedUserId);
  const mainSpeaker = pinnedParticipant || participants[0]; // Default to first remote user if no pin
  const others = participants.filter(p => p.userId !== mainSpeaker?.userId);



  const handleRemoteVideoRef = useCallback((userId: string, el: HTMLVideoElement | null) => {
    console.log(`[VideoRef] Callback for ${userId}, el: ${!!el}, src: ${el?.src}, srcObject: ${!!el?.srcObject}`);
    if (userId && el) {
      remoteVideoRefs.current[userId] = el;
      const socketId = userIdToSocketIdMap.current[userId];
      if (socketId && mediaSourcesRef.current[socketId]) {
        const mediaSource = mediaSourcesRef.current[socketId];

        // Always clean up old Blob URL first
        const oldSrc = el.src;
        if (oldSrc && oldSrc.startsWith('blob:')) {
          URL.revokeObjectURL(oldSrc);
          el.src = '';
        }

        if (mediaSource.readyState === 'closed') {
          console.warn(`[VideoRef] MediaSource for ${userId} is closed, cleared stale src`);
          return;
        }

        console.log(`[VideoRef] Attaching MediaSource to ${userId} (readyState: ${mediaSource.readyState})`);
        el.src = URL.createObjectURL(mediaSource);

        el.play().catch(e => {
          if (e.name !== 'AbortError') {
            console.error(`[VideoRef] Autoplay failed for ${userId}`, e);
          }
        });
      }
    }
  }, [participants]); // Re-create if participants change, but that's okay.

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden relative" >

      {/* Top Bar (View Switcher) */}
      < div className={
        cn(
          "absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-start transition-transform duration-300",
          showControls ? "translate-y-0" : "-translate-y-full"
        )
      } >
        <div className="bg-black/60 backdrop-blur-md p-2 rounded-lg text-white text-sm font-medium flex items-center gap-2">
          {isEditingTitle ? (
            <Input
              autoFocus
              value={tempTitle}
              onChange={(e) => setTempTitle(e.target.value)}
              onBlur={handleTitleUpdate}
              onKeyDown={(e) => e.key === 'Enter' && handleTitleUpdate()}
              className="h-6 w-48 bg-transparent border-none text-white focus-visible:ring-0 p-0"
            />
          ) : (
            <span
              onClick={() => {
                if (isHost) {
                  setTempTitle(meetingTitle);
                  setIsEditingTitle(true);
                }
              }}
              className={cn(isHost && "cursor-pointer hover:underline decoration-dashed underline-offset-4")}
              title={isHost ? "Click to edit title" : undefined}
            >
              {meetingTitle}
            </span>
          )}
          {isHost && !isEditingTitle && (
            <Edit2 className="w-3 h-3 text-muted-foreground cursor-pointer hover:text-white transition-colors" onClick={() => {
              setTempTitle(meetingTitle);
              setIsEditingTitle(true);
            }} />
          )}
          <span className="text-xs text-muted-foreground ml-2 border-l border-white/20 pl-2">ID: {roomId}</span>
        </div>
        <div className="bg-black/60 backdrop-blur-md p-1 rounded-lg flex gap-1">
          <Button
            variant={layoutMode === 'speaker' ? 'secondary' : 'ghost'}
            size="sm"
            className="text-white hover:bg-white/20"
            onClick={() => setLayoutMode('speaker')}
          >
            <Maximize className="w-4 h-4 mr-2" /> Speaker
          </Button>
          <Button
            variant={layoutMode === 'grid' ? 'secondary' : 'ghost'}
            size="sm"
            className="text-white hover:bg-white/20"
            onClick={() => setLayoutMode('grid')}
          >
            <LayoutGrid className="w-4 h-4 mr-2" /> Gallery
          </Button>
        </div>
      </div >

      <div className="flex flex-1 overflow-hidden relative">
        <ReactionOverlay reactions={reactions} />
        {/* Main Content Area */}
        <main className={cn(
          "flex-1 bg-neutral-900 relative p-4 flex items-center justify-center transition-all duration-300",
          showChatPanel ? "mr-0" : "mr-0"
        )}>
          {layoutMode === 'speaker' ? (
            // Speaker View
            <div className="w-full h-full flex flex-col md:flex-row gap-4">
              {/* Main Stage */}
              <div className="flex-1 relative rounded-xl overflow-hidden bg-black border border-white/10 shadow-2xl">
                {mainSpeaker ? (
                  <ParticipantCard
                    key={mainSpeaker.userId}
                    participant={mainSpeaker}
                    isPinned={mainSpeaker.userId === pinnedUserId}
                    className="w-full h-full rounded-none border-0"
                    onRemoteVideoRef={handleRemoteVideoRef}
                  />
                ) : (
                  <ParticipantCard
                    key="local-main"
                    participant={{ userId: 'local', username: session?.user?.name || 'Me', hasVideo: localVideoOn, isMuted: isMuted, avatar_url: session?.user?.image || undefined }}
                    isLocal={true}
                    localVideoOn={localVideoOn}
                    localStream={localStream}
                    setLocalVideoRef={(el) => { localVideoRef.current = el; }}
                    className="w-full h-full rounded-none border-0"
                  />
                )}
              </div>
              {/* Filmstrip */}
              {(participants.length > 0) && (
                <div className="h-32 md:h-full md:w-48 lg:w-64 flex md:flex-col gap-2 overflow-x-auto md:overflow-y-auto scrollbar-hide">
                  {mainSpeaker && (
                    <ParticipantCard
                      participant={{ userId: 'local', username: session?.user?.name || 'Me', hasVideo: localVideoOn, isMuted: isMuted, avatar_url: session?.user?.image || undefined }}
                      isLocal={true}
                      localVideoOn={localVideoOn}
                      localStream={localStream}
                      setLocalVideoRef={(el) => { localVideoRef.current = el; }}
                      className="min-w-[160px] md:min-w-0 md:h-32 lg:h-40 aspect-video flex-shrink-0"
                    />
                  )}
                  {others.map(p => (
                    <ParticipantCard
                      key={p.userId}
                      participant={p}
                      isPinned={p.userId === pinnedUserId}
                      className="min-w-[160px] md:min-w-0 md:h-32 lg:h-40 aspect-video flex-shrink-0"
                      onRemoteVideoRef={handleRemoteVideoRef}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Grid View
            <div className={cn(
              "w-full h-full grid gap-4 p-4 overflow-y-auto auto-rows-fr",
              (participants.length + 1) <= 1 ? "grid-cols-1" :
                (participants.length + 1) <= 2 ? "grid-cols-1 md:grid-cols-2" :
                  (participants.length + 1) <= 4 ? "grid-cols-2" :
                    (participants.length + 1) <= 9 ? "grid-cols-2 md:grid-cols-3" :
                      "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
            )}>
              <ParticipantCard
                participant={{ userId: 'local', username: session?.user?.name || 'Me', hasVideo: localVideoOn, isMuted: isMuted, avatar_url: session?.user?.image || undefined }}
                isLocal={true}
                localVideoOn={localVideoOn}
                localStream={localStream}
                isMuted={isMuted}
                setLocalVideoRef={(el) => { localVideoRef.current = el; }}
              />
              {participants.map(p => (
                <ParticipantCard
                  key={p.userId}
                  participant={p}
                  isPinned={p.userId === pinnedUserId}
                  onPin={(userId) => setPinnedUserId(pinnedUserId === userId ? null : userId)}
                  onRemoteVideoRef={handleRemoteVideoRef}
                />
              ))}
            </div>
          )}
        </main>

        {/* Chat Panel (Right Sidebar) */}
        {
          showChatPanel && (
            <ChatPanel
              messages={chatMessages}
              currentUserId={(session?.user as any)?.id || session?.user?.email}
              newMessage={newMessage}
              onNewMessageChange={setNewMessage}
              onSendMessage={sendMessage}
              onClose={() => setShowChatPanel(false)}
            />
          )
        }
      </div >

      {/* Control Bar Toggle Button */}
      < div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-300 flex flex-col items-center gap-4"
        style={{ bottom: showControls ? '80px' : '20px' }}>

        {showControls && (
          <ReactionBar onReaction={handleSendReaction} />
        )}

        <Button
          variant="secondary"
          size="sm"
          className="rounded-full shadow-lg bg-background/80 backdrop-blur-sm border hover:bg-background"
          onClick={() => setShowControls(!showControls)}
        >
          {showControls ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </Button>
      </div >

      {/* Control Bar */}
      < div className={
        cn(
          "fixed bottom-0 left-0 right-0 h-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t z-40 transition-transform duration-300 ease-in-out flex items-center justify-center space-x-4",
          showControls ? "translate-y-0" : "translate-y-full"
        )
      } >
        <Button
          variant={isMuted ? "destructive" : "secondary"}
          size="icon"
          className="rounded-full w-12 h-12"
          onClick={toggleMute}
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </Button>

        <Button
          variant={localVideoOn ? "secondary" : "destructive"}
          size="icon"
          className="rounded-full w-12 h-12"
          onClick={toggleCamera}
        >
          {localVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </Button>

        <Button variant="secondary" size="icon" className="rounded-full w-12 h-12" onClick={() => setShowMorePanel(true)}>
          <Settings className="w-5 h-5" />
        </Button>

        <Button variant="secondary" size="icon" className="rounded-full w-12 h-12" onClick={() => setShowParticipantsPanel(true)}>
          <Users className="w-5 h-5" />
        </Button>

        <Button
          variant={showChatPanel ? "default" : "secondary"}
          size="icon"
          className="rounded-full w-12 h-12"
          onClick={() => setShowChatPanel(!showChatPanel)}
        >
          <MessageSquare className="w-5 h-5" />
        </Button>

        <div className="w-px h-8 bg-border mx-2" />

        <Button
          variant="destructive"
          className="rounded-full px-6 h-12 font-semibold bg-red-600 hover:bg-red-700"
          onClick={handleEndCallClick}
        >
          End Call
        </Button>
      </div >


      {/* Participants Panel (Modal) */}
      {
        showParticipantsPanel && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowParticipantsPanel(false)}>
            <div className="bg-card p-6 rounded-xl shadow-2xl w-full max-w-md m-4 border max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Participants ({participants.length + 1})</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowParticipantsPanel(false)}>Close</Button>
              </div>

              <div className="overflow-y-auto flex-1 space-y-2">
                {/* Local User */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-secondary/50">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold">
                      {session?.user?.name?.[0]?.toUpperCase() || 'ME'}
                    </div>
                    <span className="font-medium">{session?.user?.name || 'Me'} (You)</span>
                  </div>
                  <div className="flex gap-2">
                    {isMuted ? <MicOff className="w-4 h-4 text-red-500" /> : <Mic className="w-4 h-4 text-green-500" />}
                    {localVideoOn ? <Video className="w-4 h-4 text-green-500" /> : <VideoOff className="w-4 h-4 text-red-500" />}
                  </div>
                </div>

                {/* Remote Users */}
                {participants.map(p => (
                  <div key={p.userId} className="flex items-center justify-between p-2 rounded-lg hover:bg-secondary/30">
                    <div className="flex items-center gap-3">
                      {p.avatar_url ? (
                        <Image src={p.avatar_url} alt={p.username} width={32} height={32} className="rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold">
                          {p.username?.[0]?.toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium">{p.username}</span>
                    </div>
                    <div className="flex gap-2">
                      {p.isMuted ? <MicOff className="w-4 h-4 text-red-500" /> : <Mic className="w-4 h-4 text-green-500" />}
                      {p.hasVideo ? <Video className="w-4 h-4 text-green-500" /> : <VideoOff className="w-4 h-4 text-red-500" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      }

      {/* Settings / More Panel (Modal) */}
      {
        showMorePanel && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowMorePanel(false)}>
            <div className="bg-card p-6 rounded-xl shadow-2xl w-full max-w-md m-4 border" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Settings</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowMorePanel(false)}>Close</Button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Camera</label>
                  <select
                    className="w-full p-2 border rounded-md bg-secondary"
                    value={selectedVideoDeviceId || ''}
                    onChange={(e) => setSelectedVideoDeviceId(e.target.value)}
                  >
                    {availableVideoDevices.map(device => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${device.deviceId}`}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Microphone</label>
                  <select
                    className="w-full p-2 border rounded-md bg-secondary"
                    value={selectedAudioInputDeviceId || ''}
                    onChange={(e) => setSelectedAudioInputDeviceId(e.target.value)}
                  >
                    {availableAudioInputDevices.map(device => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${device.deviceId}`}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Speaker</label>
                  <select
                    className="w-full p-2 border rounded-md bg-secondary"
                    value={selectedAudioOutputDeviceId || ''}
                    onChange={(e) => setSelectedAudioOutputDeviceId(e.target.value)}
                  >
                    {availableAudioOutputDevices.map(device => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label || `Speaker ${device.deviceId}`}</option>
                    ))}
                  </select>
                </div>

                <div className="w-full flex items-center space-x-2 pt-2">
                  <span title="Mic Volume">🎤</span>
                  <input
                    type="range" min="0" max="3" step="0.1" value={micVolume}
                    onChange={(e) => setMicVolume(parseFloat(e.target.value))}
                    className="w-full h-2 bg-muted-foreground rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-xs w-8 text-right">{(micVolume * 100).toFixed(0)}%</span>
                </div>

                <div className="w-full flex items-center space-x-2 pt-2">
                  <span title="Speaker Volume">🔊</span>
                  <input
                    type="range" min="0" max="1" step="0.05" value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-full h-2 bg-muted-foreground rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-xs w-8 text-right">{(volume * 100).toFixed(0)}%</span>
                </div>

                <div className="flex items-center justify-between pt-4 border-t">
                  <span className="text-sm font-medium">Exit Immediately</span>
                  <input
                    type="checkbox"
                    className="w-5 h-5"
                    checked={exitImmediately}
                    onChange={handleExitImmediatelyChange}
                  />
                </div>

                <Button className="w-full mt-4" onClick={copyLink}>
                  {isLinkCopied ? 'Link Copied!' : 'Copy Meeting Link'}
                </Button>
              </div>
            </div>
          </div>
        )
      }

      {/* End Call Modal */}
      {
        showEndCallModal && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
            <div className="bg-card p-6 rounded-xl shadow-2xl max-w-sm w-full mx-4 border">
              <h3 className="text-lg font-bold mb-2">Leave Meeting?</h3>
              <p className="text-muted-foreground mb-6">Are you sure you want to leave this meeting?</p>
              <div className="flex justify-end space-x-3">
                <Button variant="outline" onClick={() => setShowEndCallModal(false)}>Cancel</Button>
                <Button variant="destructive" onClick={leaveRoom}>Leave Meeting</Button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}
