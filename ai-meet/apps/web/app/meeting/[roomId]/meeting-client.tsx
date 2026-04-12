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
  Users, MessageSquare, Settings, X, Send, ChevronUp, ChevronDown, Edit2, Trash2, Subtitles, Languages
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

export interface SubtitleData {
  id: string;
  userId: string;
  userName: string;
  ko: string;
  en: string;
  ja: string;
  zh: string;
  latencyMs?: number;        // ⏱️ End-to-end latency in ms
  clientTimestamp?: number;  // Unix ms when STT captured the speech
}

export type SubtitleLang = 'all' | 'ko' | 'en' | 'ja' | 'zh';

export default function MeetingClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { data: session, status } = useSession();

  const currentUserId = session?.user?.id || session?.user?.email || 'initializing';
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localVideoOn, setLocalVideoOn] = useState(false);
  const localVideoOnRef = useRef(false);
  const [isMuted, setIsMuted] = useState(true);
  const isMutedRef = useRef(true);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string | null>(null);
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [availableAudioInputDevices, setAvailableAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState<string | null>(null);
  const [availableAudioOutputDevices, setAvailableAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [micVolume, setMicVolume] = useState(1.0); // Local Mic Gain (0.0 to 3.0)

  // Subtitles State
  const [isSubtitlesEnabled, setIsSubtitlesEnabled] = useState(false);
  const isSubtitlesEnabledRef = useRef(false);
  const [subtitleLang, setSubtitleLang] = useState<SubtitleLang>('all'); // language to DISPLAY
  const [sttLang, setSttLang] = useState(''); // language user SPEAKS (for STT accuracy)
  const [subtitles, setSubtitles] = useState<SubtitleData[]>([]);
  const recognitionRef = useRef<any>(null);
  
  // Microphone Settings
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [echoCancellation, setEchoCancellation] = useState(true);

  // Latency stats for Settings panel
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);

  const [meetingTitle, setMeetingTitle] = useState("Meeting Room");
  const [isHost, setIsHost] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState("");

  // Reaction State
  const [reactions, setReactions] = useState<Reaction[]>([]);

  // UI State
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('speaker');


  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [showParticipantsPanel, setShowParticipantsPanel] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
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
  const mediaSourceUrlsRef = useRef<{ [socketId: string]: string }>({}); // Track created Object URLs

  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const [showEndCallModal, setShowEndCallModal] = useState(false);
  const [showMorePanel, setShowMorePanel] = useState(false);
  const [exitImmediately, setExitImmediately] = useState(false);

  // Speaking Indicator State
  const [speakingParticipants, setSpeakingParticipants] = useState<Set<string>>(new Set());
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const speakingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSpeakingRef = useRef<boolean>(false);

  // Load initial settings from sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedSettings = sessionStorage.getItem(`meeting-settings-${roomId}`);
      if (storedSettings) {
        try {
          const settings = JSON.parse(storedSettings);
          if (settings.joinMuted !== undefined) {
            setIsMuted(settings.joinMuted);
            isMutedRef.current = settings.joinMuted;
          }
          // If joinVideoOff is true, localVideoOn should be false.
          // If joinVideoOff is false, localVideoOn should be true.
          if (settings.joinVideoOff !== undefined) {
            setLocalVideoOn(!settings.joinVideoOff);
            localVideoOnRef.current = !settings.joinVideoOff;
          }
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



  useEffect(() => {
    const savedSetting = localStorage.getItem('exitImmediately') === 'true';
    setExitImmediately(savedSetting);
  }, []);

  // --- Subtitles STT Setup ---
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
         const recognition = new SpeechRecognition();
         recognition.continuous = true;
         recognition.interimResults = true; // Show interim results so user sees it's working
         recognition.lang = sttLang; // Empty = auto-detect browser language, or explicitly set (ko-KR, en-US, etc)
         recognition.maxAlternatives = 1;

         let restartTimeoutRef: ReturnType<typeof setTimeout> | null = null;
         let interimFlushTimer: ReturnType<typeof setTimeout> | null = null;
         let lastInterimText = '';
         let lastSentText = ''; // Prevent duplicate sends

         recognition.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const transcript = event.results[i][0].transcript.trim();

              if (event.results[i].isFinal) {
                // ✅ Final result arrived — send immediately and cancel any pending interim flush
                if (interimFlushTimer) { clearTimeout(interimFlushTimer); interimFlushTimer = null; }
                if (transcript && transcript !== lastSentText && socketRef.current) {
                    console.log("[STT] Final:", transcript);
                    lastSentText = transcript;
                    socketRef.current.emit('stt-recognize', {
                      roomId,
                      text: transcript,
                      clientTimestamp: Date.now(),
                    });
                }
                lastInterimText = '';
              } else {
                // ⏱️ Interim result — if text stays stable for 1s, force-send it
                lastInterimText = transcript;
                if (interimFlushTimer) clearTimeout(interimFlushTimer);
                interimFlushTimer = setTimeout(() => {
                  if (lastInterimText && lastInterimText !== lastSentText && socketRef.current) {
                    console.log("[STT] Interim flush (1s stable):", lastInterimText);
                    lastSentText = lastInterimText;
                    socketRef.current.emit('stt-recognize', {
                      roomId,
                      text: lastInterimText,
                      clientTimestamp: Date.now(),
                    });
                  }
                  lastInterimText = '';
                }, 1000); // 1초 동안 변화 없으면 강제 전송
              }
            }
         };

         recognition.onerror = (event: any) => {
            if (event.error === 'no-speech') return; // Normal silence, ignore

            console.warn("[STT] Error:", event.error);

            // For network/aborted errors, schedule a restart
            if (['network', 'aborted', 'service-not-allowed'].includes(event.error)) {
              if (restartTimeoutRef) clearTimeout(restartTimeoutRef);
              restartTimeoutRef = setTimeout(() => {
                if (isSubtitlesEnabledRef.current) {
                  try { recognition.start(); } catch (e) {}
                }
              }, 500);
            }
         };

         recognition.onend = () => {
             // KEY FIX: Delay restart by 300ms to avoid race condition where browser
             // is still "stopping" and rejects the immediate start() call silently
             if (isSubtitlesEnabledRef.current) {
               if (restartTimeoutRef) clearTimeout(restartTimeoutRef);
               restartTimeoutRef = setTimeout(() => {
                 if (isSubtitlesEnabledRef.current) {
                   try { recognition.start(); } catch (e) {}
                 }
               }, 300);
             }
         };

         recognitionRef.current = recognition;
      } else {
         console.warn("[STT] Speech Recognition API not supported in this browser.");
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [roomId]);

  useEffect(() => {
    isSubtitlesEnabledRef.current = isSubtitlesEnabled;
    if (isSubtitlesEnabled && !isMuted && recognitionRef.current) {
      try { recognitionRef.current.start(); console.log("[STT] Started (CC on + mic on)"); } catch (e) {}
    } else if (recognitionRef.current) {
      try { recognitionRef.current.stop(); console.log("[STT] Stopped"); } catch (e) {}
    }
  }, [isSubtitlesEnabled]);

  // STT follows mic mute state: muted → stop STT, unmuted → start STT (if CC is on)
  useEffect(() => {
    if (!recognitionRef.current) return;
    if (isSubtitlesEnabled && !isMuted) {
      try { recognitionRef.current.start(); console.log("[STT] Resumed (mic unmuted)"); } catch (e) {}
    } else if (isMuted) {
      try { recognitionRef.current.stop(); console.log("[STT] Paused (mic muted)"); } catch (e) {}
    }
  }, [isMuted, isSubtitlesEnabled]);

  // Dynamic Device Detection
  useEffect(() => {
    const updateDevices = async () => {
      try {
        console.log('Client: Devices changed, re-enumerating...');
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAvailableVideoDevices(devices.filter(device => device.kind === 'videoinput'));
        setAvailableAudioInputDevices(devices.filter(device => device.kind === 'audioinput'));
        setAvailableAudioOutputDevices(devices.filter(device => device.kind === 'audiooutput'));
      } catch (err) {
        console.error('Error re-enumerating devices:', err);
      }
    };

    navigator.mediaDevices.addEventListener('devicechange', updateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
    };
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

      console.log('Client: currentUser set to', currentUserId);

      const username = session?.user?.name || 'Anonymous';
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

        // Calculate initial settings
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

        const username = session?.user?.name || session?.user?.email || 'Anonymous';
        socket.emit('join-room', {
          roomId,
          username,
          avatar_url: session?.user?.image || undefined,
          hasVideo: initialVideoOn, // Correct initial state
          isMuted: initialMuted     // Correct initial state
        });

        // RECONNECTION HANDLING:
        // If we already have an active stream, DO NOT re-initialize it. 
        // Re-initialization stops tracks and kills the camera, causing black screens on mobile flakiness.
        if (localStreamRef.current && localStreamRef.current.active) {
          console.log('Client: Stream already active on reconnect. Resuming MediaRecorder...');

          // Re-construct mixed stream for recorder (Video + Processed Audio)
          const tracks: MediaStreamTrack[] = [];
          const videoTrack = localStreamRef.current.getVideoTracks()[0];
          if (videoTrack) tracks.push(videoTrack);

          const processedAudioTrack = audioDestinationRef.current?.stream?.getAudioTracks()[0];
          const rawAudioTrack = localStreamRef.current.getAudioTracks()[0];

          if (processedAudioTrack) {
            tracks.push(processedAudioTrack);
          } else if (rawAudioTrack) {
            tracks.push(rawAudioTrack);
          }

          if (tracks.length > 0) {
            const mixedStream = new MediaStream(tracks);
            setupMediaRecorder(mixedStream);
          }
        } else {
          console.log('Client: Initial connection or stream lost. Initializing media...');
          initializeMediaStream(initialVideoOn, initialMuted, true)
            .then(() => console.log('Client: initializeMediaStream completed successfully.'))
            .catch(err => console.error('Client: initializeMediaStream failed:', err));
        }
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
        // Use ref to get the latest value (state may be stale in this closure)
        if (localStreamRef.current && localVideoOnRef.current) {
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

        // Update map for reference
        socketIdToUserIdMap.current[socketId] = userId;
        userIdToSocketIdMap.current[userId] = socketId;

        // Ensure MediaSource is open
        if (!mediaSourcesRef.current[socketId] || mediaSourcesRef.current[socketId].readyState === 'closed') {
          if (mediaSourcesRef.current[socketId]) {
            cleanupMediaSource(socketId);
          }
          setupMediaSource(userId, socketId, mimeType);
        }

        // Measure Latency
        if ((data as any).timestamp) {
          const now = Date.now();
          const transmissionLatency = now - (data as any).timestamp;
          if (transmissionLatency > 500 || Math.random() < 0.1) {
            console.log(`[Latency] End-to-End: ${transmissionLatency}ms (${userId})`);
          }
        }

        const sourceBuffer = sourceBuffersRef.current[socketId];
        const mediaSource = mediaSourcesRef.current[socketId];

        // Always queue if sourceBuffer doesn't exist yet
        if (!sourceBuffer) {
          if (!chunkQueueRef.current[socketId]) {
            chunkQueueRef.current[socketId] = [];
          }
          // Limit queue size to prevent memory overflow on slow connections
          if (chunkQueueRef.current[socketId].length > 30) {
            chunkQueueRef.current[socketId].shift(); // Drop oldest chunk
          }
          chunkQueueRef.current[socketId].push(blob);
          return;
        }

        // 항상 큐(Queue)에 먼저 넣어 클러스터 순서(Timestamp)가 꼬이지 않도록 엄격하게 유지
        if (!chunkQueueRef.current[socketId]) {
          chunkQueueRef.current[socketId] = [];
        }
        // Limit queue size to prevent memory overflow
        if (chunkQueueRef.current[socketId].length > 30) {
          chunkQueueRef.current[socketId].shift(); // Drop oldest chunk
        }
        chunkQueueRef.current[socketId].push(blob);

        // 버퍼가 비어있고, 넣을 데이터가 큐에 존재하면 즉시 큐를 재가동(Jumpstart)
        if (!sourceBuffer.updating && mediaSource && mediaSource.readyState === 'open') {
          const nextChunk = chunkQueueRef.current[socketId][0]; // Peek
          if (nextChunk) {
            try {
              sourceBuffer.appendBuffer(await nextChunk.arrayBuffer());
              chunkQueueRef.current[socketId].shift(); // 정상적으로 들어갔을 때만 큐에서 제거
            } catch (e) {
              if (e instanceof DOMException && e.name === 'InvalidStateError') {
                console.warn(`Ignored InvalidStateError for ${socketId} (likely cleanup race condition)`);
              } else {
                console.error(`Error appending buffer for ${socketId}`, e);
                chunkQueueRef.current[socketId].shift(); // 치명적 에러 시 데드락 방지를 위해 버림
              }
            }
          }
        }
      });

      socket.on('mic-state-changed', (data: { userId: string; isMuted: boolean }) => {
        setParticipants(prev => prev.map(p => p.userId === data.userId ? { ...p, isMuted: data.isMuted } : p));
      });

      socket.on('camera-state-changed', (data: { userId: string; hasVideo: boolean }) => {
        console.log(`[Client] Camera state changed for userId=${data.userId}, hasVideo=${data.hasVideo}, currentUserId=${currentUserId}`);

        // REMOVED: Do NOT reset MediaSource. Stream is continuous.
        // Just update the UI state.

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

      socket.on('speaking-start', ({ userId }: { userId: string }) => {
        setSpeakingParticipants(prev => new Set(prev).add(userId));
      });

      socket.on('speaking-stop', ({ userId }: { userId: string }) => {
        setSpeakingParticipants(prev => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      });

      // STREAMING SUBTITLE HANDLERS (3-step pipeline)

      // Step 1: Original text arrives instantly → show placeholder immediately
      socket.on('subtitle-stream-start', (data: { id: string; userId: string; userName: string; originalText: string; clientTimestamp?: number }) => {
        const placeholder: SubtitleData = {
          id: data.id,
          userId: data.userId,
          userName: data.userName,
          ko: data.originalText,
          en: '...',
          ja: '...',
          zh: '...',
          latencyMs: undefined, // Not yet known
          clientTimestamp: data.clientTimestamp,
        };
        setSubtitles(prev => {
          const newSubtitles = [...prev, placeholder];
          return newSubtitles.length > 5 ? newSubtitles.slice(-5) : newSubtitles;
        });

        // 🛡️ Safety net: If backend fails and 'subtitle-broadcast' never arrives, remove the stuck subtitle after 8 seconds
        setTimeout(() => {
          setSubtitles(prev => prev.filter(s => s.id !== data.id));
        }, 8000);
      });

      // Step 2: Raw streaming tokens arrive (for visual typing feedback - optional)
      // We intentionally skip re-rendering partial JSON to avoid flickering
      // subtitle-stream-chunk is received but we wait for the final broadcast

      // Step 3: Final parsed translations arrive → replace placeholder in-place
      socket.on('subtitle-broadcast', (data: SubtitleData) => {
        // ⏱️ Calculate total end-to-end latency
        const latencyMs = data.clientTimestamp ? Date.now() - data.clientTimestamp : undefined;
        if (latencyMs) {
          console.log(`[Subtitle Latency] ${latencyMs}ms`);
          // Keep last 20 measurements for rolling average
          setLatencyHistory(prev => [...prev.slice(-19), latencyMs]);
        }

        setSubtitles(prev =>
          // Replace the matching placeholder with final translated version
          prev.map(s => s.id === data.id ? { ...data, latencyMs } : s)
        );
        // Auto-remove after 6 seconds
        setTimeout(() => {
          setSubtitles(prev => prev.filter(s => s.id !== data.id));
        }, 6000);
      });

      socket.on('stream-reset', ({ userId }: { userId: string }) => {
        const socketId = userIdToSocketIdMap.current[userId];
        if (socketId) {
          console.log(`[StreamReset] Received stream reset for ${userId}, cleaning up MediaSource...`);
          cleanupMediaSource(socketId);
        }
      });

      socket.on('request-keyframe', ({ fromUserId }: { fromUserId: string }) => {
        console.log(`[Keyframe] Received request for keyframe from ${fromUserId}, restarting MediaRecorder...`);
        if (localStreamRef.current && localVideoOnRef.current) {
          setupMediaRecorder(localStreamRef.current);
        } else if (isScreenSharing && screenStreamRef.current) {
          // If we are screen sharing, restart that stream instead
          // Need to reconstruct the mixed stream
          const tracks: MediaStreamTrack[] = [];
          const screenVideoTrack = screenStreamRef.current.getVideoTracks()[0];
          if (screenVideoTrack) tracks.push(screenVideoTrack);
          const screenAudioTrack = screenStreamRef.current.getAudioTracks()[0];
          const micAudioTrack = audioDestinationRef.current?.stream?.getAudioTracks()[0];
          if (screenAudioTrack) {
            tracks.push(screenAudioTrack);
          } else if (micAudioTrack) {
            tracks.push(micAudioTrack);
          }
          const mixedStream = new MediaStream(tracks);
          setupMediaRecorder(mixedStream);
        }
      });

      socket.on('chat-error', (data: { message: string }) => {
        console.error('[ChatDebug] Chat error received:', data.message);
        if (data.message.includes('Room not found') || data.message.includes('Participant not found')) {
          console.log('[ChatDebug] Room/Participant missing on server. Attempting to re-join...');
          socket.emit('join-room', {
            roomId,
            username: session?.user?.name || session?.user?.email || 'Anonymous',
            avatar_url: session?.user?.image || undefined,
            hasVideo: localVideoOnRef.current,
            isMuted: isMutedRef.current
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
      } else {
        console.log('Client: Socket ref was null on cleanup');
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
      gainNodeRef.current.gain.value = isMuted ? 0 : micVolume;
    }
  }, [micVolume, isMuted]);

  const setLocalVideoRef = useCallback((element: HTMLVideoElement | null) => {
    localVideoRef.current = element;
    if (element) {
      if (isScreenSharing && screenStreamRef.current) {
        element.srcObject = screenStreamRef.current;
      } else if (localStream) {
        element.srcObject = localStream;
      }
    }
  }, [localStream, isScreenSharing]);

  // Also use useEffect to update when localStream or isScreenSharing changes
  useEffect(() => {
    if (localVideoRef.current) {
      if (isScreenSharing && screenStreamRef.current) {
        localVideoRef.current.srcObject = screenStreamRef.current;
      } else if (localStream) {
        localVideoRef.current.srcObject = localStream;
      }
      localVideoRef.current.muted = true;
    }
  }, [localStream, localVideoOn, isScreenSharing]);

  const setupMediaRecorder = (stream: MediaStream) => {
    if (mediaRecorderRef.current) {
      // Prevent old recorder from firing 'ondataavailable' after we decide to switch
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
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
            socketRef.current.emit('media-chunk', {
              chunk: event.data,
              mimeType,
              timestamp: Date.now() // Add timestamp for latency measurement
            });
          } else {
            console.warn(`[MediaRecorder] Skipping empty chunk or no socket. Data size: ${event.data?.size}, Socket: ${!!socketRef.current}`);
          }
        };
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.start(500); // 500ms 딜레이로 변경하여 과도한 패킷 분할(Fragmentation) 오버헤드 방지
        console.log('Client: MediaRecorder started with 500ms intervals');
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
      const url = URL.createObjectURL(mediaSource);
      mediaSourceUrlsRef.current[socketId] = url;
      videoElement.src = url;
      videoElement.onloadedmetadata = () => videoElement.play().catch(e => console.error("Autoplay failed", e));
    }

    mediaSource.addEventListener('sourceopen', async () => {
      console.log(`MediaSource opened for ${socketId}`);
      try {
        if (!MediaSource.isTypeSupported(mimeType)) {
          console.error(`${mimeType} is not supported`);
          return;
        }

        // 방어 로직: sourceopen 이벤트가 트리거되는 그 짧은 사이에 
        // 유저가 방을 나가거나 스트림을 초기화하여 mediaSource가 닫힌(closed) 상태일 수 있음
        if (mediaSource.readyState !== 'open') {
          console.warn(`[MediaSource] Aborting addSourceBuffer for ${socketId} because readyState is ${mediaSource.readyState}`);
          return;
        }

        // 방어 로직 2: React 리렌더링 등으로 인해 sourceopen이 재차 발생했을 때 버퍼 중복 추가 방지
        if (mediaSource.sourceBuffers.length > 0) {
          console.warn(`[MediaSource] SourceBuffer already exists for ${socketId}, skipping duplicate addition.`);
          return;
        }

        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        sourceBuffersRef.current[socketId] = sourceBuffer;

        sourceBuffer.addEventListener('updateend', async () => {
          // Safety check: Ensure the buffer is still active and the MediaSource is open
          if (!sourceBuffersRef.current[socketId] || mediaSource.readyState !== 'open') return;

          const userId = socketIdToUserIdMap.current[socketId];
          const videoElement = userId ? remoteVideoRefs.current[userId] : null;
          const currentTime = videoElement?.currentTime || 0;

          try {
            // Prune old buffer data to prevent memory overflow
            if (sourceBuffer.buffered.length > 0 && !sourceBuffer.updating) {
              const bufferStart = sourceBuffer.buffered.start(0);
              const bufferEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
              const bufferDuration = bufferEnd - bufferStart;

              // Periodic status log (every ~5 seconds approx based on update frequency)
              if (Math.random() < 0.1) {
                console.log(`[Buffer Status] Socket: ${socketId}, Total Buffer: ${bufferDuration.toFixed(2)}s, Current: ${currentTime.toFixed(2)}s`);
              }

              // Keep only last 20 seconds of buffer 
              if (currentTime - bufferStart > 20) {
                try {
                  const removeEnd = Math.max(bufferStart, currentTime - 20);
                  sourceBuffer.remove(bufferStart, removeEnd);
                  console.log(`[Buffer] Pruning old data for ${socketId}: ${bufferStart.toFixed(2)}s to ${removeEnd.toFixed(2)}s (Saving Memory)`);
                  return; // Wait for next updateend to process queue
                } catch (e) {
                  console.warn(`[Buffer] Failed to prune for ${socketId}`, e);
                }
              }
            }
          } catch (e) {
            console.warn(`[Buffer] SourceBuffer error during updateend for ${socketId}`, e);
          }

          // Latency Management (Smooth Catch-up Logic)
          // Instead of jumping (which causes visible freezes), gradually speed up
          // playback to smoothly close the gap with the live edge.
          if (videoElement && !videoElement.paused) {
            try {
              const buffered = sourceBuffer.buffered;
              if (buffered.length > 0) {
                const end = buffered.end(buffered.length - 1);
                const latency = end - currentTime;

                // Emergency jump (only for extreme lag > 5s, e.g. tab was backgrounded)
                if (latency > 5) {
                  console.log(`[Latency] Emergency jump to live edge (Lag: ${latency.toFixed(2)}s)`);
                  videoElement.currentTime = end - 0.3;
                  videoElement.playbackRate = 1.0;
                }
                // Tier 3: Fast catch-up (1.5s ~ 5s lag) → 1.1x speed
                else if (latency > 1.5) {
                  if (videoElement.playbackRate !== 1.1) {
                    console.log(`[Latency] 1.1x speed (Lag: ${latency.toFixed(2)}s)`);
                    videoElement.playbackRate = 1.1;
                  }
                }
                // Tier 2: Medium catch-up (0.8s ~ 1.5s lag) → 1.05x speed
                else if (latency > 0.8) {
                  if (videoElement.playbackRate !== 1.05) {
                    console.log(`[Latency] 1.05x speed (Lag: ${latency.toFixed(2)}s)`);
                    videoElement.playbackRate = 1.05;
                  }
                }
                // Tier 1: Gentle catch-up (0.3s ~ 0.8s lag) → 1.02x speed
                else if (latency > 0.3) {
                  if (videoElement.playbackRate !== 1.02) {
                    videoElement.playbackRate = 1.02;
                  }
                }
                // Normal: Synced (< 0.3s lag) → 1.0x speed
                else {
                  if (videoElement.playbackRate !== 1.0) {
                    console.log(`[Latency] Synced! (Lag: ${latency.toFixed(2)}s)`);
                    videoElement.playbackRate = 1.0;
                  }
                }
              }
            } catch (e) {
              console.warn(`[Latency] Error in catch-up logic for ${socketId}`, e);
            }
          }

          // Process queued chunks
          if (chunkQueueRef.current[socketId]?.length > 0 && !sourceBuffer.updating && mediaSource.readyState === 'open') {
            const nextChunk = chunkQueueRef.current[socketId][0]; // Peek first
            if (nextChunk) {
              try {
                const buffer = await nextChunk.arrayBuffer();
                sourceBuffer.appendBuffer(buffer);
                chunkQueueRef.current[socketId].shift(); // Remove only on success (or handled error)
              } catch (e: any) {
                if (e.name === 'QuotaExceededError') {
                  console.warn(`[Buffer] QuotaExceededError for ${socketId}. Aggressively pruning...`);
                  try {
                    if (sourceBuffer.buffered.length > 0 && !sourceBuffer.updating) {
                      const bufferStart = sourceBuffer.buffered.start(0);
                      const ct = videoElement?.currentTime || bufferStart;
                      const removeEnd = Math.max(bufferStart + 5, ct - 5);
                      sourceBuffer.remove(bufferStart, removeEnd);
                      console.log(`[Buffer] Emergency prune: ${bufferStart.toFixed(2)} to ${removeEnd.toFixed(2)}`);
                    }
                  } catch (pruneErr) {
                    console.warn(`[Buffer] Emergency prune failed`, pruneErr);
                  }
                  // Do NOT shift the chunk, retry later? 
                  // Actually, if we remove, updateend will fire, and we can try again.
                  // But we need to make sure we don't loop infinitely.
                  // For now, let's drop the chunk if we can't append, to avoid stalling.
                  chunkQueueRef.current[socketId].shift();
                } else if (e instanceof DOMException && e.name === 'InvalidStateError') {
                  console.warn(`Ignored InvalidStateError in queue for ${socketId}`);
                  chunkQueueRef.current[socketId].shift();
                } else {
                  console.error(`Error appending queued buffer for ${socketId}`, e);
                  chunkQueueRef.current[socketId].shift();
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

    // Clear cached URL so we don't reuse a revoked one
    if (mediaSourceUrlsRef.current[socketId]) {
      delete mediaSourceUrlsRef.current[socketId];
    }
  };


  const initializeMediaStream = async (initialVideoOn: boolean = false, initialMuted: boolean = true, isInitial: boolean = false) => {
    try {
      console.log(`Client: Initializing media stream (Initial video: ${initialVideoOn}, Initial muted: ${initialMuted})...`);

      // 1. Check for available devices first
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      const hasVideoDevice = videoDevices.length > 0;

      setAvailableVideoDevices(videoDevices);
      setAvailableAudioInputDevices(devices.filter(device => device.kind === 'audioinput'));
      setAvailableAudioOutputDevices(devices.filter(device => device.kind === 'audiooutput'));

      console.log(`Client: Video devices found: ${videoDevices.length}`);

      // 2. Construct constraints based on device availability
      const audioConstraint: boolean | MediaTrackConstraints = selectedAudioInputDeviceId
        ? {
          deviceId: { exact: selectedAudioInputDeviceId },
          echoCancellation: echoCancellation,
          noiseSuppression: noiseSuppression,
          autoGainControl: true
        }
        : {
          echoCancellation: echoCancellation,
          noiseSuppression: noiseSuppression,
          autoGainControl: true
        };

      let stream: MediaStream;

      if (hasVideoDevice) {
        // Camera available: Request both
        const videoConstraint: boolean | MediaTrackConstraints = selectedVideoDeviceId
          ? { deviceId: { exact: selectedVideoDeviceId } }
          : true;

        console.log('Client: Requesting Audio + Video');
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraint,
          audio: audioConstraint
        });
      } else {
        // No Camera: Request Audio Only
        console.log('Client: No camera found. Requesting Audio Only.');
        stream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: audioConstraint
        });
      }

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

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // --- Speaking Detection Setup ---
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserNodeRef.current = analyser;

      if (speakingIntervalRef.current) clearInterval(speakingIntervalRef.current);

      speakingIntervalRef.current = setInterval(() => {
        if (!analyserNodeRef.current || isMuted) {
          if (isSpeakingRef.current) {
            isSpeakingRef.current = false;
            socketRef.current?.emit('speaking-stop', { roomId, userId: currentUserId });
            setSpeakingParticipants(prev => {
              const next = new Set(prev);
              next.delete(currentUserId);
              return next;
            });
          }
          return;
        }

        const bufferLength = analyserNodeRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNodeRef.current.getByteFrequencyData(dataArray);

        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        // Threshold for "speaking" (adjustable)
        // Increased to 40 to reduce false positives from echo
        const threshold = 40;
        const isNowSpeaking = average > threshold;

        if (isNowSpeaking !== isSpeakingRef.current) {
          isSpeakingRef.current = isNowSpeaking;
          if (isNowSpeaking) {
            socketRef.current?.emit('speaking-start', { roomId, userId: currentUserId });
            setSpeakingParticipants(prev => new Set(prev).add(currentUserId));
          } else {
            socketRef.current?.emit('speaking-stop', { roomId, userId: currentUserId });
            setSpeakingParticipants(prev => {
              const next = new Set(prev);
              next.delete(currentUserId);
              return next;
            });
          }
        }
      }, 100); // Check every 100ms
      // -------------------------------

      // Create a mixed stream for MediaRecorder (ALWAYS includes both audio and video)
      const processedAudioTrack = destination.stream.getAudioTracks()[0];
      const tracks: MediaStreamTrack[] = [...stream.getVideoTracks()];
      if (processedAudioTrack) {
        tracks.push(processedAudioTrack);
      }
      const mixedStream = new MediaStream(tracks);
      // -------------------------------------------

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      setLocalStream(stream);
      localStreamRef.current = stream;
      console.log('Client: localStreamRef.current set:', !!localStreamRef.current, 'Tracks:', stream.getTracks().length);
      setLocalVideoOn(initialVideoOn);
      localVideoOnRef.current = initialVideoOn;
      setIsMuted(initialMuted);
      isMutedRef.current = initialMuted;
      console.log('Client: Media stream initialized (always-on mode).');

      setupMediaRecorder(mixedStream);

      // Emit initial camera state
      socketRef.current?.emit('camera-state-changed', {
        roomId,
        userId: currentUserId,
        hasVideo: initialVideoOn
      });

      // Emit initial mic state
      socketRef.current?.emit('mic-state-changed', {
        roomId,
        userId: currentUserId,
        isMuted: initialMuted
      });

      // If not initial load (e.g. device switch), notify others to reset their buffers
      if (!isInitial) {
        console.log('Client: Device switched, emitting stream-reset');
        socketRef.current?.emit('stream-reset', { roomId, userId: currentUserId });
      }

    } catch (err: any) {
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
      alert('카메라를 찾을 수 없거나 초기화되지 않았습니다.');
      return;
    }

    console.log(`[toggleCamera] Current enabled: ${videoTrack.enabled}, localVideoOn: ${localVideoOn}`);
    videoTrack.enabled = !videoTrack.enabled;
    setLocalVideoOn(videoTrack.enabled);
    localVideoOnRef.current = videoTrack.enabled;
    console.log(`[toggleCamera] New enabled: ${videoTrack.enabled}, will set localVideoOn to: ${videoTrack.enabled}`);

    // When camera is turned back ON, restart MediaRecorder to send fresh init segment
    // and notify receivers to recreate their MediaSource
    if (videoTrack.enabled && localStreamRef.current) {
      console.log('[toggleCamera] Camera ON: Restarting MediaRecorder and sending stream-reset');
      setupMediaRecorder(localStreamRef.current);
      socketRef.current?.emit('stream-reset', { roomId, userId: currentUserId });
    }

    socketRef.current?.emit('camera-state-changed', {
      roomId,
      userId: currentUserId,
      hasVideo: videoTrack.enabled,
    });
    console.log(`[toggleCamera] Emitted camera-state-changed: roomId=${roomId}, userId=${currentUserId}, hasVideo=${videoTrack.enabled}`);
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Stop screen sharing safely (prevent recursive onended loop)
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => {
          track.onended = null; // Disable event listener before stopping manually
          track.stop();
        });
      }
      screenStreamRef.current = null;
      setIsScreenSharing(false);

      // Restore camera stream
      if (localStreamRef.current) {
        // Re-construct mixed stream for recorder
        const tracks: MediaStreamTrack[] = [];
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) tracks.push(videoTrack);

        const processedAudioTrack = audioDestinationRef.current?.stream?.getAudioTracks()[0];
        if (processedAudioTrack) tracks.push(processedAudioTrack);

        const mixedStream = new MediaStream(tracks);
        setupMediaRecorder(mixedStream);

        // Notify others
        socketRef.current?.emit('camera-state-changed', {
          roomId,
          userId: currentUserId,
          hasVideo: localVideoOn
        });
        socketRef.current?.emit('stream-reset', { roomId, userId: currentUserId });
      }
    } else {
      // Start screen sharing
      try {
        const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({
          video: { cursor: "always" } as any,
          audio: true // Support system audio
        });

        screenStreamRef.current = screenStream;
        setIsScreenSharing(true);

        // Handle browser's "Stop Sharing" button
        screenStream.getVideoTracks()[0].onended = () => {
          toggleScreenShare(); // Recurse to stop and restore
        };

        // Re-construct mixed stream for recorder (Screen Video + Mic/System Audio)
        const tracks: MediaStreamTrack[] = [];
        const screenVideoTrack = screenStream.getVideoTracks()[0];
        if (screenVideoTrack) tracks.push(screenVideoTrack);

        // Optionally mix in system audio if available, or stay with mic
        const screenAudioTrack = screenStream.getAudioTracks()[0];
        const micAudioTrack = audioDestinationRef.current?.stream?.getAudioTracks()[0];

        if (screenAudioTrack) {
          tracks.push(screenAudioTrack);
        } else if (micAudioTrack) {
          tracks.push(micAudioTrack);
        }

        const mixedStream = new MediaStream(tracks);
        setupMediaRecorder(mixedStream);

        // Notify others
        socketRef.current?.emit('camera-state-changed', {
          roomId,
          userId: currentUserId,
          hasVideo: true
        });
        socketRef.current?.emit('stream-reset', { roomId, userId: currentUserId });

      } catch (err) {
        console.error("Screen share failed:", err);
      }
    }
  };

  const toggleMute = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    isMutedRef.current = newMutedState;

    // 1. Web Audio API (GainNode) 볼륨 조절
    if (gainNodeRef.current) {
      // micVolume 변수가 스코프에 없거나 깨졌을 수 있으므로 기본값 1 적용
      gainNodeRef.current.gain.value = newMutedState ? 0 : 1; 
    }

    // 2. 하드웨어 마이크 트랙(MediaStreamTrack) 직접 제어 (가장 확실한 방법)
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !newMutedState;
        console.log(`[toggleMute] Hardware audio track enabled: ${audioTrack.enabled}`);
      }
    }

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
  };

  // Auto-hide controls logic
  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isHoveringControlsRef = useRef(false);

  const resetControlsTimer = useCallback(() => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
    }
    autoHideTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  }, []);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, [resetControlsTimer]);

  // NOTE: Latency management is handled inside the MediaSource updateend handler
  // with a smooth 4-tier catch-up system (1.02x / 1.05x / 1.1x / emergency jump).
  // No additional interval-based latency check is needed here.




  const handleControlsMouseEnter = () => {
    isHoveringControlsRef.current = true;
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
  };

  const handleControlsMouseLeave = () => {
    isHoveringControlsRef.current = false;
    if (showControls) resetControlsTimer();
  };

  const handleRemoteVideoRef = useCallback((userId: string, el: HTMLVideoElement | null) => {
    console.log(`[VideoRef] Callback for ${userId}, el: ${!!el}, src: ${el?.src}, srcObject: ${!!el?.srcObject}`);
    if (userId && el) {
      remoteVideoRefs.current[userId] = el;

      // Apply selected audio output device
      if (selectedAudioOutputDeviceId && typeof (el as any).setSinkId === 'function') {
        try {
          (el as any).setSinkId(selectedAudioOutputDeviceId);
        } catch (e) {
          console.error(`[VideoRef] Failed to set sinkId for ${userId}`, e);
        }
      }

      const socketId = userIdToSocketIdMap.current[userId];

      if (socketId && mediaSourcesRef.current[socketId]) {
        const mediaSource = mediaSourcesRef.current[socketId];
        const currentUrl = mediaSourceUrlsRef.current[socketId];

        // STRICT CHECK: Only skip if the element is playing the EXACT SAME Blob URL
        if (el.src && el.src === currentUrl && mediaSource.readyState === 'open') {
          console.log(`[VideoRef] Skipping re-attach for ${userId}, already playing correct blob: ${currentUrl}`);
          return;
        }

        // Always clean up old Blob URL first
        const oldSrc = el.src;
        if (oldSrc && oldSrc.startsWith('blob:') && oldSrc !== currentUrl) {
          URL.revokeObjectURL(oldSrc);
          el.src = '';
        }

        if (mediaSource.readyState === 'closed') {
          console.warn(`[VideoRef] MediaSource for ${userId} is closed, triggering FULL cleanup`);
          cleanupMediaSource(socketId);
          return;
        }

        console.log(`[VideoRef] Attaching MediaSource to ${userId} (readyState: ${mediaSource.readyState})`);

        // Create new URL if we don't have one or if we are re-attaching
        let newUrl = currentUrl;
        if (!newUrl) {
          newUrl = URL.createObjectURL(mediaSource);
          mediaSourceUrlsRef.current[socketId] = newUrl;
        }

        // Force refresh if re-attaching (Layout Switch)
        if (el.src !== newUrl) {
          console.log(`[VideoRef] Requesting keyframe for ${userId} due to re-attach`);
          socketRef.current?.emit('request-keyframe', { roomId, userId });
        }

        el.src = newUrl;

        // Error Recovery Listener
        const errorHandler = (e: Event) => {
          const videoError = (e.target as HTMLVideoElement).error;
          const errorCode = videoError?.code || 0;
          // Only force cleanup for fatal errors (MEDIA_ERR_DECODE=3, MEDIA_ERR_SRC_NOT_SUPPORTED=4)
          // Minor errors (MEDIA_ERR_ABORTED=1, MEDIA_ERR_NETWORK=2) can self-recover
          if (errorCode >= 3) {
            console.error(`[VideoRef] Fatal video error for ${userId} (code ${errorCode}):`, videoError?.message);
            cleanupMediaSource(socketId);
          } else {
            console.warn(`[VideoRef] Minor video error for ${userId} (code ${errorCode}), auto-recovering...`);
            // Re-attach the listener for next potential error
            el.addEventListener('error', errorHandler, { once: true });
          }
        };
        el.addEventListener('error', errorHandler, { once: true });

        el.play().then(() => {
          console.log(`[VideoRef] Autoplay started for ${userId}`);
        }).catch(e => {
          if (e.name !== 'AbortError') {
            console.error(`[VideoRef] Autoplay failed for ${userId}`, e);
          }
        });
      } else {
        console.warn(`[VideoRef] No MediaSource found for ${userId} (socketId: ${socketId})`);
      }
    }
  }, [selectedAudioOutputDeviceId]);

  // --- Render Logic ---
  const localParticipant = { userId: currentUserId, username: 'Me', isMuted, hasVideo: localVideoOn, isLocal: true };
  const pinnedParticipant = participants.find(p => p.userId === pinnedUserId) || (pinnedUserId === currentUserId ? localParticipant : null);
  const mainSpeaker = pinnedParticipant || participants[0] || localParticipant; // Default to first remote user, or Me if alone

  return (
    <div
      className="fixed inset-0 bg-background text-foreground overflow-hidden"
      onClick={() => {
        if (showControls) {
          setShowControls(false);
          if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
        } else {
          setShowControls(true);
          resetControlsTimer();
        }
      }}
      onMouseMove={() => {
        if (showControls) {
          resetControlsTimer();
        }
      }}
    >
      <div className="flex flex-1 overflow-hidden relative flex-col md:flex-row h-full">
        <main className="flex-1 bg-neutral-900 relative p-4 pb-20 md:pb-4 flex items-center justify-center transition-all duration-300 overflow-hidden group min-h-0">

          <div
            onMouseEnter={handleControlsMouseEnter}
            onMouseLeave={handleControlsMouseLeave}
            className={cn(
              "absolute top-0 left-0 right-0 p-4 md:p-6 z-20 flex justify-between items-start transition-all duration-500 ease-out",
              showControls ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Meeting Info */}
            <div className="bg-black/40 backdrop-blur-xl p-2.5 md:p-3 rounded-2xl text-white shadow-lg border border-white/10 flex items-center gap-3">
              <div className="flex flex-col">
                {isEditingTitle ? (
                  <Input
                    autoFocus
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onBlur={handleTitleUpdate}
                    onKeyDown={(e) => e.key === 'Enter' && handleTitleUpdate()}
                    className="h-6 w-48 bg-black/50 border-white/20 text-white focus-visible:ring-1 focus-visible:ring-primary p-1 text-sm rounded"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <span
                      onClick={() => {
                        if (isHost) {
                          setTempTitle(meetingTitle);
                          setIsEditingTitle(true);
                        }
                      }}
                      className={cn("font-semibold text-sm md:text-base tracking-wide", isHost && "cursor-pointer hover:underline decoration-dashed underline-offset-4")}
                      title={isHost ? "Click to edit title" : undefined}
                    >
                      {meetingTitle}
                    </span>
                    {isHost && !isEditingTitle && (
                      <Edit2 className="w-3 h-3 text-white/50 cursor-pointer hover:text-white transition-colors" onClick={() => {
                        setTempTitle(meetingTitle);
                        setIsEditingTitle(true);
                      }} />
                    )}
                  </div>
                )}
                <span className="text-[10px] md:text-xs text-white/50 font-mono mt-0.5 tracking-wider hidden md:block">ID: {roomId}</span>
              </div>
            </div>

            {/* View Mode Controls */}
            <div className="bg-black/40 backdrop-blur-xl p-1 md:p-1.5 rounded-2xl flex gap-1 border border-white/10 shadow-lg">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "text-white transition-all rounded-xl px-3 py-1.5 h-auto",
                  layoutMode === 'speaker' ? "bg-white/20 shadow-sm" : "hover:bg-white/10 opacity-70 hover:opacity-100"
                )}
                onClick={() => setLayoutMode('speaker')}
              >
                <Maximize className="w-4 h-4 md:mr-2" /> <span className="text-sm font-medium hidden md:inline">Speaker</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "text-white transition-all rounded-xl px-3 py-1.5 h-auto",
                  layoutMode === 'grid' ? "bg-white/20 shadow-sm" : "hover:bg-white/10 opacity-70 hover:opacity-100"
                )}
                onClick={() => setLayoutMode('grid')}
              >
                <LayoutGrid className="w-4 h-4 md:mr-2" /> <span className="text-sm font-medium hidden md:inline">Gallery</span>
              </Button>
            </div>
          </div>

          {/* Main Video Area */}
          <div className="w-full h-full p-2 md:p-4 pt-14 min-h-0 flex flex-col">

            {layoutMode === 'grid' ? (
              /* --- GRID VIEW (Smart Grid) --- */
              <div className="flex-1 flex flex-wrap justify-center content-center gap-2 md:gap-4 w-full h-full p-2 overflow-y-auto">
                {[localParticipant, ...participants.filter(p => p.userId !== currentUserId)].map((p, index, array) => {
                  const count = array.length;
                  let gridClass = "w-full h-full"; // Default 1 user

                  if (count === 2) {
                    gridClass = "w-full h-[48%] md:w-[48%] md:h-full"; // 2 users: Stacked on mobile, side-by-side on desktop
                  } else if (count <= 4) {
                    gridClass = "w-[48%] h-[48%]"; // 3-4 users: 2x2 grid
                  } else if (count <= 6) {
                    gridClass = "w-[48%] h-[32%] md:w-[32%] md:h-[48%]"; // 5-6 users: Handle mobile vs desktop proportions
                  } else if (count <= 9) {
                    gridClass = "w-[32%] h-[32%]"; // 7-9 users: 3x3 grid
                  } else {
                    gridClass = "w-[32%] h-[24%] md:w-[24%] md:h-[24%]"; // 10+ users: Max 4x4
                  }

                  return (
                    <div key={p.userId} className={cn("relative transition-all duration-300 ease-in-out", gridClass)}>
                      <ParticipantCard
                        participant={p}
                        isLocal={p.userId === currentUserId}
                        localStream={p.userId === currentUserId ? localStreamRef.current : undefined}
                        localVideoOn={p.userId === currentUserId ? localVideoOn : undefined}
                        onRemoteVideoRef={p.userId !== currentUserId ? handleRemoteVideoRef : undefined}
                        isPinned={pinnedUserId === p.userId}
                        onPin={() => setPinnedUserId(pinnedUserId === p.userId ? null : p.userId)}
                        isSpeaking={speakingParticipants.has(p.userId)}
                        className="w-full h-full border border-white/10 rounded-xl md:rounded-2xl bg-black/40 overflow-hidden shadow-lg"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              /* --- SPEAKER VIEW (Filmstrip) --- */
              <div className="flex-1 flex flex-col w-full h-full overflow-hidden gap-2">
                {/* Main Stage (Active Speaker) */}
                <div className="flex-1 relative w-full min-h-0 bg-black/20 rounded-lg overflow-hidden border border-white/10">
                  <ParticipantCard
                    participant={mainSpeaker}
                    isLocal={mainSpeaker.userId === currentUserId}
                    localStream={mainSpeaker.userId === currentUserId ? localStreamRef.current : undefined}
                    localVideoOn={mainSpeaker.userId === currentUserId ? localVideoOn : undefined}
                    onRemoteVideoRef={mainSpeaker.userId !== currentUserId ? handleRemoteVideoRef : undefined}
                    isPinned={pinnedUserId === mainSpeaker.userId}
                    onPin={() => setPinnedUserId(pinnedUserId === mainSpeaker.userId ? null : mainSpeaker.userId)}
                    isSpeaking={speakingParticipants.has(mainSpeaker.userId)}
                    className="w-full h-full"
                  />
                </div>

                {/* Filmstrip (Other Participants) */}
                <div className="h-24 md:h-32 flex gap-2 overflow-x-auto overflow-y-hidden pb-2 px-1 flex-shrink-0 snap-x">
                  {[localParticipant, ...participants.filter(p => p.userId !== currentUserId)]
                    .filter(p => p.userId !== mainSpeaker.userId) // Exclude main speaker
                    .map(p => (
                      <div key={p.userId} className="w-32 md:w-48 h-full flex-shrink-0 snap-start">
                        <ParticipantCard
                          participant={p}
                          isLocal={p.userId === currentUserId}
                          localStream={p.userId === currentUserId ? localStreamRef.current : undefined}
                          localVideoOn={p.userId === currentUserId ? localVideoOn : undefined}
                          onRemoteVideoRef={p.userId !== currentUserId ? handleRemoteVideoRef : undefined}
                          isPinned={pinnedUserId === p.userId}
                          onPin={() => setPinnedUserId(pinnedUserId === p.userId ? null : p.userId)}
                          isSpeaking={speakingParticipants.has(p.userId)}
                          className="w-full h-full border-2 border-transparent hover:border-primary/50 transition-all"
                        />
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Reaction Overlay */}
          <ReactionOverlay reactions={reactions} />

          {/* Subtitles Overlay (Netflix Style) */}
          {isSubtitlesEnabled && subtitles.length > 0 && (
            <div className="absolute bottom-32 left-0 right-0 z-40 flex flex-col items-center justify-end pointer-events-none px-4 gap-2">
              {subtitles.map((sub) => (
                <div key={sub.id} className="bg-black/70 backdrop-blur-sm px-4 py-2 rounded-lg max-w-3xl w-full text-center shadow-2xl animate-in slide-in-from-bottom-2 fade-in duration-300">
                  {/* Speaker name + latency badge */}
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span className="text-xs text-blue-300 font-bold opacity-90">{sub.userName}</span>
                    {sub.latencyMs && (
                      <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full font-mono font-bold">
                        ⚡ {sub.latencyMs}ms
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {(subtitleLang === 'all' || subtitleLang === 'ko') && (
                      <p className="text-white font-medium text-sm md:text-base leading-snug drop-shadow-md">🇰🇷 {sub.ko}</p>
                    )}
                    {(subtitleLang === 'all' || subtitleLang === 'en') && (
                      <p className="text-yellow-400 font-medium text-sm md:text-base leading-snug drop-shadow-md">🇺🇸 {sub.en}</p>
                    )}
                    {(subtitleLang === 'all' || subtitleLang === 'ja') && (
                      <p className="text-green-300 font-medium text-sm md:text-base leading-snug drop-shadow-md">🇯🇵 {sub.ja}</p>
                    )}
                    {(subtitleLang === 'all' || subtitleLang === 'zh') && (
                      <p className="text-pink-300 font-medium text-sm md:text-base leading-snug drop-shadow-md">🇨🇳 {sub.zh}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reaction Bar (Floating) */}
          <div className={cn(
            "absolute bottom-24 left-1/2 transform -translate-x-1/2 z-30 transition-opacity duration-300",
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          )}>
            <ReactionBar onReaction={(emoji) => {
              if (socketRef.current) {
                socketRef.current.emit('reaction', { roomId, emoji });
                // Optimistic update
                const newReaction: Reaction = {
                  id: Math.random().toString(36).substr(2, 9),
                  emoji,
                  userId: currentUserId
                };
                setReactions(prev => [...prev, newReaction]);
                setTimeout(() => {
                  setReactions(prev => prev.filter(r => r.id !== newReaction.id));
                }, 2000);
              }
            }} />
          </div>

          {/* Floating Control Bar */}
          <div
            onMouseEnter={handleControlsMouseEnter}
            onMouseLeave={handleControlsMouseLeave}
            className={cn(
              "fixed z-50 transition-all duration-500 ease-out flex items-center justify-center gap-1 md:gap-2 shadow-2xl",
              // Mobile Styles: Bottom fixed
              "bottom-4 left-4 right-4 h-auto bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl px-2 py-2",
              // Desktop Styles: Floating pill, centered
              "md:bottom-8 md:left-1/2 md:transform md:-translate-x-1/2 md:bg-[#1C1F2E]/90 md:rounded-3xl md:px-4 md:py-2 md:w-auto",
              showControls ? "translate-y-0 opacity-100" : "translate-y-24 opacity-0 pointer-events-none"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Audio/Video Controls */}
            <div className="flex items-center gap-1 md:gap-2 border-r border-white/10 pr-2 md:pr-4 mr-1 md:mr-2">
              <Button
                variant="ghost"
                className={cn(
                  "flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-xl hover:bg-white/10 text-white transition-all",
                  isMuted && "text-red-500 hover:bg-red-500/10 hover:text-red-400"
                )}
                onClick={toggleMute}
              >
                {isMuted ? <MicOff className="w-5 h-5 md:w-6 md:h-6 mb-1" /> : <Mic className="w-5 h-5 md:w-6 md:h-6 mb-1" />}
                <span className="text-[10px] md:text-xs font-medium">{isMuted ? 'Unmute' : 'Mute'}</span>
              </Button>

              <Button
                variant="ghost"
                className={cn(
                  "flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-xl hover:bg-white/10 text-white transition-all",
                  !localVideoOn && "text-red-500 hover:bg-red-500/10 hover:text-red-400"
                )}
                onClick={toggleCamera}
              >
                {localVideoOn ? <Video className="w-5 h-5 md:w-6 md:h-6 mb-1" /> : <VideoOff className="w-5 h-5 md:w-6 md:h-6 mb-1" />}
                <span className="text-[10px] md:text-xs font-medium">{localVideoOn ? 'Stop Video' : 'Start Video'}</span>
              </Button>

              <Button
                variant="ghost"
                className={cn(
                  "flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-xl hover:bg-white/10 text-white transition-all",
                  isScreenSharing && "text-blue-400 bg-white/10"
                )}
                onClick={toggleScreenShare}
              >
                <MonitorUp className="w-5 h-5 md:w-6 md:h-6 mb-1" />
                <span className="text-[10px] md:text-xs font-medium">{isScreenSharing ? 'Stop Share' : 'Screen Share'}</span>
              </Button>

              <div className="relative group">
                <Button
                  variant="ghost"
                  className={cn(
                    "flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-xl hover:bg-white/10 text-white transition-all",
                    isSubtitlesEnabled && "text-yellow-400 bg-white/10"
                  )}
                  onClick={() => setIsSubtitlesEnabled(!isSubtitlesEnabled)}
                >
                  <Subtitles className="w-5 h-5 md:w-6 md:h-6 mb-1" />
                  <span className="text-[10px] md:text-xs font-medium">CC</span>
                </Button>
                
                {/* Language Selector Popup (Visible on Hover when CC is active) */}
                {isSubtitlesEnabled && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black/90 backdrop-blur-md rounded-lg p-3 flex flex-col gap-3 border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-xl">
                    {/* View Language */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-gray-400 font-bold px-1 mb-0.5">표시할 자막 (Display)</span>
                      <div className="flex gap-1">
                        {['all', 'ko', 'en', 'ja', 'zh'].map((lang) => (
                          <button
                            key={'view-' + lang}
                            className={cn(
                              "text-xs px-2.5 py-1 rounded hover:bg-white/20 transition-colors uppercase font-bold text-center flex-1",
                              subtitleLang === lang ? "bg-primary text-white" : "text-gray-300 bg-white/5"
                            )}
                            onClick={(e) => { e.stopPropagation(); setSubtitleLang(lang as SubtitleLang); }}
                          >
                            {lang === 'all' ? 'All' : lang}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="h-px bg-white/10 w-full" />

                    {/* Speak Language (STT) */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-gray-400 font-bold px-1 mb-0.5">내가 말하는 언어 (STT)</span>
                      <div className="flex gap-1 justify-between">
                        {[
                          { val: '', label: 'Auto' },
                          { val: 'ko-KR', label: 'KO' },
                          { val: 'en-US', label: 'EN' },
                          { val: 'ja-JP', label: 'JA' },
                          { val: 'zh-CN', label: 'ZH' },
                        ].map((lang) => (
                          <button
                            key={'stt-' + lang.val}
                            className={cn(
                              "text-xs px-2.5 py-1 rounded hover:bg-white/20 transition-colors uppercase font-bold text-center flex-1",
                              sttLang === lang.val ? "bg-blue-500 text-white" : "text-gray-300 bg-white/5"
                            )}
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setSttLang(lang.val); 
                              // Restart STT with new language immediately
                              if (recognitionRef.current) {
                                recognitionRef.current.lang = lang.val;
                                recognitionRef.current.stop(); // onend handler will restart it
                              }
                            }}
                          >
                            {lang.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* General Controls */}
            <div className="flex items-center gap-1 md:gap-2">
              <Button
                variant="ghost"
                className={cn(
                  "flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-xl hover:bg-white/10 text-white transition-all relative",
                  showParticipantsPanel && "bg-white/20 text-blue-400"
                )}
                onClick={() => setShowParticipantsPanel(true)}
              >
                <Users className="w-5 h-5 md:w-6 md:h-6 mb-1" />
                <span className="text-[10px] md:text-xs font-medium hidden md:block">Participants</span>
                <span className="absolute top-1 right-2 bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] flex items-center justify-center">
                  {participants.length + 1}
                </span>
              </Button>

              <Button
                variant="ghost"
                className={cn(
                  "flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-xl hover:bg-white/10 text-white transition-all",
                  showChatPanel && "bg-white/20 text-blue-400"
                )}
                onClick={() => setShowChatPanel(!showChatPanel)}
              >
                <MessageSquare className="w-5 h-5 md:w-6 md:h-6 mb-1" />
                <span className="text-[10px] md:text-xs font-medium hidden md:block">Chat</span>
              </Button>

              <Button
                variant="ghost"
                className="flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-xl hover:bg-white/10 text-white transition-all"
                onClick={() => setShowMorePanel(true)}
              >
                <Settings className="w-5 h-5 md:w-6 md:h-6 mb-1" />
                <span className="text-[10px] md:text-xs font-medium hidden md:block">Settings</span>
              </Button>
            </div>

            {/* End Call */}
            <div className="pl-2 md:pl-4 ml-1 md:ml-2 border-l border-white/10 flex items-center">
              <Button
                variant="destructive"
                className="rounded-xl md:rounded-2xl px-4 md:px-6 h-10 md:h-14 font-semibold shadow-lg shadow-red-500/20 hover:shadow-red-500/40 text-sm md:text-base flex items-center gap-2"
                onClick={handleEndCallClick}
              >
                End <span className="hidden md:inline">Meeting</span>
              </Button>
            </div>
          </div>

        </main>

        {/* Chat Panel (Responsive) */}
        <div
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 bg-background border-t border-border transition-transform duration-300 ease-in-out md:relative md:inset-auto md:border-l md:border-t-0 md:w-80 md:translate-y-0 flex flex-col shadow-2xl md:shadow-none rounded-t-2xl md:rounded-none overflow-hidden",
            showChatPanel ? "translate-y-0 h-[60vh] md:h-auto" : "translate-y-full h-0 md:h-auto md:hidden md:w-0"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <ChatPanel
            messages={chatMessages}
            currentUserId={(session?.user as any)?.id || session?.user?.email}
            newMessage={newMessage}
            onNewMessageChange={setNewMessage}
            onSendMessage={sendMessage}
            onClose={() => setShowChatPanel(false)}
          />
        </div>

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

                  <div className="pt-2 pb-2 -mx-2 px-4 space-y-3 bg-secondary/20 rounded-lg">
                    <label className="text-sm font-bold text-gray-300 flex items-center gap-2">
                      <Mic className="w-4 h-4 text-blue-400"/> 오디오 보정 (효과 적용 시 마이크 껐다 켜기)
                    </label>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400 flex items-center gap-2">
                        <span>잡음 제거 (Noise Suppression)</span>
                      </span>
                      <input
                        type="checkbox"
                        className="w-4 h-4 cursor-pointer accent-blue-500"
                        checked={noiseSuppression}
                        onChange={(e) => setNoiseSuppression(e.target.checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400 flex items-center gap-2">
                        <span>에코 무시 (Echo Cancellation)</span>
                      </span>
                      <input
                        type="checkbox"
                        className="w-4 h-4 cursor-pointer accent-blue-500"
                        checked={echoCancellation}
                        onChange={(e) => setEchoCancellation(e.target.checked)}
                      />
                    </div>
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

                  {/* ⏱️ AI Subtitle Latency Stats (for demo presentation) */}
                  {latencyHistory.length > 0 && (
                    <div className="pt-4 border-t space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold">⚡ AI 자막 지연시간 통계</span>
                        <button
                          className="text-xs text-muted-foreground hover:text-red-400 transition-colors"
                          onClick={() => setLatencyHistory([])}
                        >
                          초기화
                        </button>
                      </div>

                      {/* Stats Grid */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-secondary/60 rounded-lg p-2 text-center">
                          <div className="text-lg font-bold text-green-400">
                            {Math.round(latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length)}ms
                          </div>
                          <div className="text-[10px] text-muted-foreground">평균</div>
                        </div>
                        <div className="bg-secondary/60 rounded-lg p-2 text-center">
                          <div className="text-lg font-bold text-blue-400">
                            {Math.min(...latencyHistory)}ms
                          </div>
                          <div className="text-[10px] text-muted-foreground">최소</div>
                        </div>
                        <div className="bg-secondary/60 rounded-lg p-2 text-center">
                          <div className="text-lg font-bold text-orange-400">
                            {Math.max(...latencyHistory)}ms
                          </div>
                          <div className="text-[10px] text-muted-foreground">최대</div>
                        </div>
                      </div>

                      {/* Mini Bar Chart */}
                      <div className="flex items-end gap-0.5 h-10 bg-secondary/30 rounded p-1">
                        {latencyHistory.slice(-20).map((ms, i) => {
                          const maxMs = Math.max(...latencyHistory);
                          const heightPct = Math.max(10, (ms / maxMs) * 100);
                          const color = ms < 1000 ? 'bg-green-400' : ms < 2000 ? 'bg-yellow-400' : 'bg-red-400';
                          return (
                            <div
                              key={i}
                              title={`${ms}ms`}
                              className={`flex-1 rounded-sm ${color} opacity-80 hover:opacity-100 transition-opacity`}
                              style={{ height: `${heightPct}%` }}
                            />
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>최근 {latencyHistory.length}회 측정</span>
                        <span>🟢 &lt;1s 🟡 1~2s 🔴 &gt;2s</span>
                      </div>
                    </div>
                  )}

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
      </div>
    </div>
  );
}
