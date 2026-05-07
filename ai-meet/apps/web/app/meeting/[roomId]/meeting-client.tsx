'use client';

import { useEffect, useState, useRef, useCallback, type SyntheticEvent } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { useSession } from "next-auth/react";
import Image from 'next/image';
import { Button } from "@/components/ui/button";
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff,
  MoreHorizontal, LayoutGrid, Maximize, Pin, PinOff,
  Users, MessageSquare, Settings, X, Send, ChevronUp, ChevronDown, Edit2, Trash2, Subtitles, Languages,
  Radio, Crown, Check, Copy, Clock3, Activity, Volume2
} from 'lucide-react';
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChatPanel } from "@/components/meeting/chat-panel";
import { ParticipantCard } from "@/components/meeting/participant-card";
import { ReactionBar } from "@/components/meeting/reaction-bar";
import { Reaction } from "@/components/meeting/reaction-overlay";

interface Participant {
  userId: string;
  username: string;
  hasVideo: boolean;
  isMuted: boolean;
  canBroadcast?: boolean;
  avatar_url?: string;
}

type LayoutMode = 'speaker' | 'grid';
type SttProvider = 'browser' | 'deepgram';
type BroadcastMode = 'single' | 'all';

export interface SubtitleData {
  id: string;
  userId: string;
  userName: string;
  originalText?: string;
  ko: string;
  en: string;
  ja: string;
  zh: string;
  isFinal?: boolean;
  sequence?: number;
  latencyMs?: number;        // ⏱️ End-to-end latency in ms
  clientTimestamp?: number;  // Unix ms when STT captured the speech
  serverReceivedAt?: number; // Unix ms when API received the transcript
  translationStartedAt?: number;
  translationFinishedAt?: number;
}

export type SubtitleLang = 'ko' | 'en' | 'ja' | 'zh';

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
  const [subtitleLangs, setSubtitleLangs] = useState<SubtitleLang[]>(['ko', 'en', 'ja', 'zh']); // languages to DISPLAY
  const [sttLang, setSttLang] = useState(''); // language user SPEAKS (for STT accuracy)
  const sttLangRef = useRef('');
  const [sttProvider, setSttProvider] = useState<SttProvider>('browser');
  const sttProviderRef = useRef<SttProvider>('browser');
  const [isSttSaved, setIsSttSaved] = useState(false);
  const [isSttSavingUpdating, setIsSttSavingUpdating] = useState(false);
  const [subtitles, setSubtitles] = useState<SubtitleData[]>([]);
  const recognitionRef = useRef<any>(null);
  
  // Microphone Settings
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [echoCancellation, setEchoCancellation] = useState(true);

  // Latency stats for Settings panel
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);

  const [meetingTitle, setMeetingTitle] = useState("Meeting Room");
  const [isHost, setIsHost] = useState(false);
  const [hostId, setHostId] = useState<string | null>(null);
  const [isBroadcastPresenter, setIsBroadcastPresenter] = useState(false);
  const isBroadcastPresenterRef = useRef(false);
  const [broadcastMode, setBroadcastMode] = useState<BroadcastMode>('single');
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
  const isScreenSharingRef = useRef(false);
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
  const subtitleAudioRecorderRef = useRef<MediaRecorder | null>(null);
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
  const pendingMediaChunksRef = useRef<{ chunk: Blob; mimeType: string; timestamp: number }[]>([]);
  const remoteMimeTypesRef = useRef<{ [socketId: string]: string }>({});
  const mediaSourceUrlsRef = useRef<{ [socketId: string]: string }>({}); // Track created Object URLs
  const remoteLatencyIntervalsRef = useRef<{ [socketId: string]: NodeJS.Timeout }>({});
  const remoteVideosAwaitingUserGestureRef = useRef<Set<HTMLVideoElement>>(new Set());
  const hasUserInteractedRef = useRef(false);

  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const [systemNotice, setSystemNotice] = useState('');
  const systemNoticeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showEndCallModal, setShowEndCallModal] = useState(false);
  const [showMorePanel, setShowMorePanel] = useState(false);
  const [exitImmediately, setExitImmediately] = useState(false);
  const [deleteRoomOnHostEnd, setDeleteRoomOnHostEnd] = useState(true);
  const [isEndingMeeting, setIsEndingMeeting] = useState(false);

  // Speaking Indicator State
  const [speakingParticipants, setSpeakingParticipants] = useState<Set<string>>(new Set());
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const speakingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSpeakingRef = useRef<boolean>(false);

  const closeAudioContext = useCallback(() => {
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    gainNodeRef.current = null;
    audioSourceRef.current = null;
    audioDestinationRef.current = null;
    analyserNodeRef.current = null;

    if (!audioContext || audioContext.state === 'closed') return;
    audioContext.close().catch(error => {
      if (error?.name !== 'InvalidStateError') {
        console.warn('[AudioContext] Failed to close:', error);
      }
    });
  }, []);

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
    const savedDeleteRoomSetting = localStorage.getItem('deleteRoomOnHostEnd');
    setDeleteRoomOnHostEnd(savedDeleteRoomSetting === null ? true : savedDeleteRoomSetting === 'true');
  }, []);

  useEffect(() => {
    const resumeBlockedRemoteVideos = () => {
      hasUserInteractedRef.current = true;
      const blockedVideos = Array.from(remoteVideosAwaitingUserGestureRef.current);
      remoteVideosAwaitingUserGestureRef.current.clear();

      blockedVideos.forEach(videoElement => {
        videoElement.muted = false;
        videoElement.play().catch(error => {
          console.warn('[Autoplay] Remote video still blocked after user gesture:', error);
          remoteVideosAwaitingUserGestureRef.current.add(videoElement);
        });
      });
    };

    window.addEventListener('click', resumeBlockedRemoteVideos, { capture: true });
    window.addEventListener('touchstart', resumeBlockedRemoteVideos, { capture: true });
    window.addEventListener('keydown', resumeBlockedRemoteVideos, { capture: true });

    return () => {
      window.removeEventListener('click', resumeBlockedRemoteVideos, { capture: true });
      window.removeEventListener('touchstart', resumeBlockedRemoteVideos, { capture: true });
      window.removeEventListener('keydown', resumeBlockedRemoteVideos, { capture: true });
    };
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
         let lastInterimSentAt = 0;
         let sttSequence = 0;

         const emitSttText = (text: string, isFinal: boolean) => {
            if (!isBroadcastPresenterRef.current || !text || !socketRef.current) return;
            sttSequence += 1;
            lastSentText = text;
            socketRef.current.emit('stt-recognize', {
              roomId,
              text,
              isFinal,
              sequence: sttSequence,
              sourceLang: sttLangRef.current,
              clientTimestamp: Date.now(),
            });
         };

         recognition.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const transcript = event.results[i][0].transcript.trim();

              if (event.results[i].isFinal) {
                // ✅ Final result arrived — send immediately and cancel any pending interim flush
                if (interimFlushTimer) { clearTimeout(interimFlushTimer); interimFlushTimer = null; }
                if (transcript && transcript !== lastSentText && socketRef.current) {
                    console.log("[STT] Final:", transcript);
                    emitSttText(transcript, true);
                } else if (transcript && socketRef.current) {
                    emitSttText(transcript, true);
                }
                lastInterimText = '';
              } else {
                // ⏱️ Interim result — throttle updates so captions feel live without flooding translation.
                lastInterimText = transcript;
                const now = Date.now();
                const hasMeaningfulChange = transcript.length >= 3 && transcript !== lastSentText;
                if (hasMeaningfulChange && now - lastInterimSentAt >= 700) {
                  console.log("[STT] Interim stream:", transcript);
                  lastInterimSentAt = now;
                  emitSttText(transcript, false);
                } else {
                  if (interimFlushTimer) clearTimeout(interimFlushTimer);
                  interimFlushTimer = setTimeout(() => {
                    if (lastInterimText && lastInterimText !== lastSentText && socketRef.current) {
                      console.log("[STT] Interim flush:", lastInterimText);
                      lastInterimSentAt = Date.now();
                      emitSttText(lastInterimText, false);
                    }
                  }, 700);
                }
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
    if (isBroadcastPresenter && isSubtitlesEnabled && !isMuted && sttProvider === 'browser' && recognitionRef.current) {
      try { recognitionRef.current.start(); console.log("[STT] Started (CC on + mic on)"); } catch (e) {}
    } else if (recognitionRef.current) {
      try { recognitionRef.current.stop(); console.log("[STT] Stopped"); } catch (e) {}
    }
  }, [isBroadcastPresenter, isSubtitlesEnabled, isMuted, sttProvider]);

  useEffect(() => {
    sttLangRef.current = sttLang;
  }, [sttLang]);

  useEffect(() => {
    socketRef.current?.emit('subtitle-language-changed', {
      roomId,
      langs: subtitleLangs,
    });
  }, [roomId, subtitleLangs]);

  useEffect(() => {
    sttProviderRef.current = sttProvider;
  }, [sttProvider]);

  // STT follows mic mute state: muted → stop STT, unmuted → start STT (if CC is on)
  useEffect(() => {
    if (!recognitionRef.current) return;
    if (isBroadcastPresenter && isSubtitlesEnabled && !isMuted && sttProvider === 'browser') {
      try { recognitionRef.current.start(); console.log("[STT] Resumed (mic unmuted)"); } catch (e) {}
    } else if (isMuted) {
      try { recognitionRef.current.stop(); console.log("[STT] Paused (mic muted)"); } catch (e) {}
    }
  }, [isBroadcastPresenter, isMuted, isSubtitlesEnabled, sttProvider]);

  useEffect(() => {
    const shouldUseServerStt = isBroadcastPresenter && isSubtitlesEnabled && !isMuted;
    if (!shouldUseServerStt) {
      stopSubtitleAudioStreaming();
      socketRef.current?.emit('subtitle-stt-stop', { roomId });
      return;
    }

    socketRef.current?.emit('subtitle-stt-start', {
      roomId,
      sourceLang: sttLangRef.current,
    });

    return () => {
      stopSubtitleAudioStreaming();
      socketRef.current?.emit('subtitle-stt-stop', { roomId });
    };
  }, [isBroadcastPresenter, isMuted, isSubtitlesEnabled, roomId, sttLang]);

  useEffect(() => {
    if (sttProvider === 'deepgram' && isBroadcastPresenter && isSubtitlesEnabled && !isMuted) {
      try { recognitionRef.current?.stop(); } catch (e) {}
      setupSubtitleAudioStreaming();
    } else {
      stopSubtitleAudioStreaming();
    }
  }, [isBroadcastPresenter, isMuted, isSubtitlesEnabled, sttProvider]);

  const applyBroadcastPresenterState = useCallback((canBroadcast: boolean) => {
    setIsBroadcastPresenter(canBroadcast);
    isBroadcastPresenterRef.current = canBroadcast;

    if (!canBroadcast) {
      stopLocalBroadcast();
      try { recognitionRef.current?.stop(); } catch (e) {}
      socketRef.current?.emit('subtitle-stt-stop', { roomId });
      return;
    }

    let initialVideoOn = false;
    let initialMuted = true;

    if (typeof window !== 'undefined') {
      const storedSettings = sessionStorage.getItem(`meeting-settings-${roomId}`);
      if (storedSettings) {
        try {
          const settings = JSON.parse(storedSettings);
          if (settings.joinVideoOff !== undefined) initialVideoOn = !settings.joinVideoOff;
          if (settings.joinMuted !== undefined) initialMuted = settings.joinMuted;
        } catch (error) {
          console.error("Failed to parse meeting settings", error);
        }
      }
    }

    if (localStreamRef.current && localStreamRef.current.active) {
      const outgoingStream = createOutgoingStream();
      if (outgoingStream) setupMediaRecorder(outgoingStream);
      return;
    }

    initializeMediaStream(initialVideoOn, initialMuted, true)
      .then(() => console.log('Client: presenter media initialized successfully.'))
      .catch(err => console.error('Client: presenter media initialization failed:', err));
  }, [roomId]);

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
      const syncRemoteParticipants = (incomingParticipants: (Participant & { socketId: string })[]) => {
        const filteredParticipants = incomingParticipants.filter(p => p.userId !== currentUserId);
        const activeRemoteUserIds = new Set(filteredParticipants.map(p => p.userId));

        incomingParticipants.forEach(p => {
          if (p.userId !== currentUserId) {
            socketIdToUserIdMap.current[p.socketId] = p.userId;
            userIdToSocketIdMap.current[p.userId] = p.socketId;
          }
        });

        Object.entries(userIdToSocketIdMap.current).forEach(([userId, socketId]) => {
          if (!activeRemoteUserIds.has(userId)) {
            cleanupMediaSource(socketId);
            delete socketIdToUserIdMap.current[socketId];
            delete userIdToSocketIdMap.current[userId];
          }
        });

        setParticipants(filteredParticipants);
      };

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
        flushPendingMediaChunks(socket);

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
        socket.emit('subtitle-language-changed', {
          roomId,
          langs: subtitleLangs,
        });

        // Media capture starts after room-state confirms this socket is the presenter.
      });

      socket.on('room-state', async (data: { participants: (Participant & { socketId: string })[], title?: string, hostId?: string, canBroadcast?: boolean; broadcastMode?: BroadcastMode; isSttSaved?: boolean }) => {
        console.log('Client: room-state received', data);
        const canBroadcast = Boolean(data.canBroadcast);

        if (data.title) setMeetingTitle(data.title);
        if (data.hostId) setHostId(data.hostId);
        if (data.broadcastMode) setBroadcastMode(data.broadcastMode);
        if (typeof data.isSttSaved === 'boolean') setIsSttSaved(data.isSttSaved);
        setIsHost(Boolean(data.hostId && data.hostId === currentUserId));

        syncRemoteParticipants(data.participants);
        applyBroadcastPresenterState(canBroadcast);
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
        if (isBroadcastPresenterRef.current && localStreamRef.current && localVideoOnRef.current) {
          console.log(`[UserJoined] Restarting MediaRecorder to send fresh Init Segment to ${data.username}`);
          const outgoingStream = createOutgoingStream();
          if (outgoingStream) setupMediaRecorder(outgoingStream);
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

      socket.on('broadcast-presenter-changed', (data: { presenterUserId: string; broadcastMode?: BroadcastMode; participants: (Participant & { socketId: string })[] }) => {
        console.log(`[Presenter] Presenter changed to ${data.presenterUserId}`);

        setBroadcastMode(data.broadcastMode ?? 'single');
        syncRemoteParticipants(data.participants);
        applyBroadcastPresenterState(data.presenterUserId === currentUserId);
      });

      socket.on('participant-list-changed', (data: { presenterUserId?: string; broadcastMode?: BroadcastMode; participants: (Participant & { socketId: string })[] }) => {
        console.log('[Participants] Participant list resynced', data);
        if (data.broadcastMode) setBroadcastMode(data.broadcastMode);
        syncRemoteParticipants(data.participants);
        const currentParticipant = data.participants.find(p => p.userId === currentUserId);
        if (currentParticipant) {
          applyBroadcastPresenterState(Boolean(currentParticipant.canBroadcast));
        }
      });

      socket.on('broadcast-mode-changed', (data: { broadcastMode: BroadcastMode; presenterUserId?: string; participants: (Participant & { socketId: string })[] }) => {
        console.log(`[Presenter] Broadcast mode changed to ${data.broadcastMode}`);
        setBroadcastMode(data.broadcastMode);
        syncRemoteParticipants(data.participants);
        const currentParticipant = data.participants.find(p => p.userId === currentUserId);
        applyBroadcastPresenterState(Boolean(currentParticipant?.canBroadcast));
      });

      socket.on('stt-saving-changed', (data: { enabled: boolean }) => {
        setIsSttSaved(data.enabled);
        setIsSttSavingUpdating(false);
        showSystemNotice(data.enabled ? 'STT 기록을 시작했습니다.' : 'STT 기록을 중지했습니다.');
      });

      socket.on('media-chunk', async (data: { socketId: string, userId?: string, chunk: ArrayBuffer | any, mimeType?: string, timestamp?: number }) => {
        const { socketId, chunk, mimeType = 'video/webm; codecs="vp8, opus"' } = data;
        const userId = data.userId;
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
        remoteMimeTypesRef.current[socketId] = mimeType;

        // Ensure MediaSource is open
        if (!mediaSourcesRef.current[socketId] || mediaSourcesRef.current[socketId].readyState === 'closed') {
          if (mediaSourcesRef.current[socketId]) {
            cleanupMediaSource(socketId);
          }
          setupMediaSource(userId, socketId, mimeType);
        }

        // Measure Latency
        if (data.timestamp) {
          const now = Date.now();
          const transmissionLatency = now - data.timestamp;
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

      socket.on('stt-provider-state', (data: { provider: SttProvider; enabled: boolean; reason?: string; model?: string }) => {
        if (data.provider === 'deepgram' && data.enabled) {
          console.log(`[STT] Deepgram streaming enabled (${data.model || 'default model'})`);
          setSttProvider('deepgram');
        } else {
          console.log(`[STT] Falling back to browser STT (${data.reason || 'server unavailable'})`);
          setSttProvider('browser');
        }
      });

      // STREAMING SUBTITLE HANDLERS (3-step pipeline)

      const getSubtitleLatencyMs = (data: Partial<SubtitleData>) => {
        if (typeof data.latencyMs === 'number') return data.latencyMs;
        if (data.translationStartedAt && data.translationFinishedAt) {
          return Math.max(0, data.translationFinishedAt - data.translationStartedAt);
        }
        if (data.serverReceivedAt) return Math.max(0, Date.now() - data.serverReceivedAt);
        if (data.clientTimestamp) return Math.max(0, Date.now() - data.clientTimestamp);
        return undefined;
      };

      const upsertStreamingSubtitle = (data: Partial<SubtitleData> & { id: string; userId: string; userName: string; originalText?: string; clientTimestamp?: number; serverReceivedAt?: number; translationStartedAt?: number; translationFinishedAt?: number }) => {
        setSubtitles(prev => {
          const existing = prev.find(s => s.id === data.id);
          const latencyMs = getSubtitleLatencyMs({ ...existing, ...data });
          const nextSubtitle: SubtitleData = existing ? {
            ...existing,
            ...data,
            ko: data.ko ?? data.originalText ?? existing.ko,
            en: data.en ?? existing.en,
            ja: data.ja ?? existing.ja,
            zh: data.zh ?? existing.zh,
            latencyMs,
            clientTimestamp: data.clientTimestamp ?? existing.clientTimestamp,
            serverReceivedAt: data.serverReceivedAt ?? existing.serverReceivedAt,
            translationStartedAt: data.translationStartedAt ?? existing.translationStartedAt,
            translationFinishedAt: data.translationFinishedAt ?? existing.translationFinishedAt,
          } : {
            id: data.id,
            userId: data.userId,
            userName: data.userName,
            originalText: data.originalText,
            ko: data.ko ?? data.originalText ?? '',
            en: data.en ?? '...',
            ja: data.ja ?? '...',
            zh: data.zh ?? '...',
            isFinal: data.isFinal,
            sequence: data.sequence,
            latencyMs,
            clientTimestamp: data.clientTimestamp,
            serverReceivedAt: data.serverReceivedAt,
            translationStartedAt: data.translationStartedAt,
            translationFinishedAt: data.translationFinishedAt,
          };

          const withoutCurrent = prev.filter(s => s.id !== data.id);
          const newSubtitles = [...withoutCurrent, nextSubtitle];
          return newSubtitles.length > 5 ? newSubtitles.slice(-5) : newSubtitles;
        });
      };

      // Step 1: Original text arrives instantly → show placeholder immediately
      socket.on('subtitle-stream-start', (data: SubtitleData & { originalText: string }) => {
        const latencyMs = getSubtitleLatencyMs(data);
        const placeholder: SubtitleData = {
          id: data.id,
          userId: data.userId,
          userName: data.userName,
          originalText: data.originalText,
          ko: data.originalText,
          en: '...',
          ja: '...',
          zh: '...',
          isFinal: data.isFinal,
          sequence: data.sequence,
          latencyMs,
          clientTimestamp: data.clientTimestamp,
          serverReceivedAt: data.serverReceivedAt,
          translationStartedAt: data.translationStartedAt,
          translationFinishedAt: data.translationFinishedAt,
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

      // Step 2: Interim translated captions update the same subtitle row in-place.
      socket.on('subtitle-stream-update', (data: SubtitleData & { originalText?: string }) => {
        upsertStreamingSubtitle({ ...data, latencyMs: getSubtitleLatencyMs(data) });
      });

      // Step 3: Final parsed translations arrive → replace placeholder in-place
      socket.on('subtitle-broadcast', (data: SubtitleData) => {
        const latencyMs = getSubtitleLatencyMs(data);
        if (typeof latencyMs === 'number') {
          console.log(`[Subtitle Latency] ${latencyMs}ms`);
          // Keep last 20 measurements for rolling average
          setLatencyHistory(prev => [...prev.slice(-19), latencyMs]);
        }

        upsertStreamingSubtitle({ ...data, latencyMs, isFinal: true });
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
        if (!isBroadcastPresenterRef.current) return;
        console.log(`[Keyframe] Received request for keyframe from ${fromUserId}, restarting MediaRecorder...`);
        const outgoingStream = createOutgoingStream(isScreenSharingRef.current ? screenStreamRef.current : localStreamRef.current);
        if (outgoingStream) setupMediaRecorder(outgoingStream);
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

      socket.on('room-ended', () => {
        showSystemNotice('방장이 회의를 종료했습니다.');
        socket.disconnect();
        router.push('/');
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
      stopSubtitleAudioStreaming();
      socketRef.current?.emit('subtitle-stt-stop', { roomId });
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
      closeAudioContext();
    };
  }, [roomId, status, currentUserId, closeAudioContext]);

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

  useEffect(() => {
    isScreenSharingRef.current = isScreenSharing;
  }, [isScreenSharing]);

  const createOutgoingStream = (videoSource: MediaStream | null = localStreamRef.current) => {
    if (!isBroadcastPresenterRef.current) return null;

    const tracks: MediaStreamTrack[] = [];
    const videoTrack = videoSource?.getVideoTracks()[0];
    if (videoTrack) tracks.push(videoTrack);

    const screenAudioTrack = videoSource && videoSource !== localStreamRef.current
      ? videoSource.getAudioTracks()[0]
      : undefined;
    const processedAudioTrack = audioDestinationRef.current?.stream?.getAudioTracks()[0];
    const rawAudioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (screenAudioTrack) {
      tracks.push(screenAudioTrack);
    } else if (processedAudioTrack) {
      tracks.push(processedAudioTrack);
    } else if (rawAudioTrack) {
      tracks.push(rawAudioTrack);
    }

    return tracks.length > 0 ? new MediaStream(tracks) : null;
  };

  const flushPendingMediaChunks = (socket: Socket | null = socketRef.current) => {
    if (!isBroadcastPresenterRef.current || !socket?.connected || pendingMediaChunksRef.current.length === 0) return;

    const pending = pendingMediaChunksRef.current.splice(0, pendingMediaChunksRef.current.length);
    for (const item of pending) {
      socket.emit('media-chunk', item);
    }
  };

  const setupMediaRecorder = (stream: MediaStream) => {
    if (!isBroadcastPresenterRef.current) {
      stopMediaRecorder();
      return;
    }

    if (mediaRecorderRef.current) {
      // Prevent old recorder from firing 'ondataavailable' after we decide to switch
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
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
          if (event.data && event.data.size > 0) {
            const mediaPacket = {
              chunk: event.data,
              mimeType,
              timestamp: Date.now() // Add timestamp for latency measurement
            };

            if (socketRef.current?.connected) {
              flushPendingMediaChunks();
              socketRef.current.emit('media-chunk', mediaPacket);
            } else {
              if (pendingMediaChunksRef.current.length > 8) {
                pendingMediaChunksRef.current.shift();
              }
              pendingMediaChunksRef.current.push(mediaPacket);
            }
          } else {
            console.warn(`[MediaRecorder] Skipping empty chunk or no socket. Data size: ${event.data?.size}, Socket: ${!!socketRef.current}`);
          }
        };
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.start(200); // 0.2s chunks for lower media relay latency
        console.log('Client: MediaRecorder started with 200ms intervals');
      } catch (e) {
        console.error('MediaRecorder setup failed:', e);
      }
    }
  };

  const stopMediaRecorder = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }
    pendingMediaChunksRef.current = [];
  };

  const setupSubtitleAudioStreaming = () => {
    if (!isBroadcastPresenterRef.current || sttProviderRef.current !== 'deepgram') return;
    if (subtitleAudioRecorderRef.current?.state === 'recording') return;

    const audioTrack = audioDestinationRef.current?.stream.getAudioTracks()[0]
      ?? localStreamRef.current?.getAudioTracks()[0];
    if (!audioTrack) return;

    const audioStream = new MediaStream([audioTrack]);
    const mimeType = MediaRecorder.isTypeSupported('audio/webm; codecs=opus')
      ? 'audio/webm; codecs=opus'
      : 'audio/webm';

    try {
      const recorder = new MediaRecorder(audioStream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        if (!socketRef.current?.connected) return;

        socketRef.current.emit('stt-audio-chunk', {
          roomId,
          chunk: event.data,
          mimeType,
          clientTimestamp: Date.now(),
        });
      };
      recorder.onstop = () => {
        socketRef.current?.emit('subtitle-stt-stop', { roomId });
      };
      subtitleAudioRecorderRef.current = recorder;
      recorder.start(250);
      console.log('[STT] Deepgram audio recorder started');
    } catch (error) {
      console.error('[STT] Failed to start Deepgram audio recorder:', error);
      setSttProvider('browser');
    }
  };

  const stopSubtitleAudioStreaming = () => {
    if (subtitleAudioRecorderRef.current) {
      subtitleAudioRecorderRef.current.ondataavailable = null;
      subtitleAudioRecorderRef.current.onstop = null;
      if (subtitleAudioRecorderRef.current.state !== 'inactive') {
        subtitleAudioRecorderRef.current.stop();
      }
      subtitleAudioRecorderRef.current = null;
    }
  };

  const stopLocalBroadcast = () => {
    stopSubtitleAudioStreaming();
    stopMediaRecorder();

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => {
        track.onended = null;
        track.stop();
      });
      screenStreamRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    closeAudioContext();

    if (speakingIntervalRef.current) {
      clearInterval(speakingIntervalRef.current);
      speakingIntervalRef.current = null;
    }

    setLocalStream(null);
    setLocalVideoOn(false);
    localVideoOnRef.current = false;
    setIsMuted(true);
    isMutedRef.current = true;
    setIsScreenSharing(false);
    isScreenSharingRef.current = false;
  };

  const playRemoteVideo = (videoElement: HTMLVideoElement, userId: string) => {
    if (hasUserInteractedRef.current) {
      videoElement.muted = false;
    }

    videoElement.play().then(() => {
      console.log(`[VideoRef] Playback started for ${userId}`);
    }).catch(error => {
      if (error.name === 'NotAllowedError') {
        console.warn(`[VideoRef] Autoplay with audio blocked for ${userId}; playing muted until user interaction.`);
        remoteVideosAwaitingUserGestureRef.current.add(videoElement);
        videoElement.muted = true;
        videoElement.play().catch(mutedError => {
          console.warn(`[VideoRef] Muted autoplay also failed for ${userId}`, mutedError);
        });
        return;
      }

      if (error.name !== 'AbortError') {
        console.error(`[VideoRef] Playback failed for ${userId}`, error);
      }
    });
  };

  const applyRemoteLiveCatchup = (socketId: string, reason: 'interval' | 'updateend' = 'interval') => {
    const sourceBuffer = sourceBuffersRef.current[socketId];
    const userId = socketIdToUserIdMap.current[socketId];
    const videoElement = userId ? remoteVideoRefs.current[userId] : null;
    if (!sourceBuffer || !videoElement || sourceBuffer.buffered.length === 0) return;

    try {
      const liveEdge = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
      const latency = liveEdge - videoElement.currentTime;

      if (videoElement.paused && videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        playRemoteVideo(videoElement, userId);
      }

      if (latency > 3) {
        videoElement.currentTime = Math.max(0, liveEdge - 0.35);
        videoElement.playbackRate = 1.0;
        console.log(`[Latency] Jumped to live edge (${latency.toFixed(2)}s, ${reason})`);
        return;
      }

      let nextRate = 1.0;
      if (latency > 1.5) nextRate = 1.25;
      else if (latency > 0.9) nextRate = 1.15;
      else if (latency > 0.45) nextRate = 1.06;

      if (Math.abs(videoElement.playbackRate - nextRate) > 0.01) {
        videoElement.playbackRate = nextRate;
        console.log(`[Latency] playbackRate=${nextRate.toFixed(2)} lag=${latency.toFixed(2)}s (${reason})`);
      }
    } catch (error) {
      console.warn(`[Latency] Catch-up failed for ${socketId}`, error);
    }
  };

  const startRemoteLatencyMonitor = (socketId: string) => {
    if (remoteLatencyIntervalsRef.current[socketId]) return;

    remoteLatencyIntervalsRef.current[socketId] = setInterval(() => {
      applyRemoteLiveCatchup(socketId, 'interval');
    }, 500);
  };

  const stopRemoteLatencyMonitor = (socketId: string) => {
    const interval = remoteLatencyIntervalsRef.current[socketId];
    if (!interval) return;
    clearInterval(interval);
    delete remoteLatencyIntervalsRef.current[socketId];
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
      videoElement.onloadedmetadata = () => playRemoteVideo(videoElement, userId);
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
        startRemoteLatencyMonitor(socketId);

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

          applyRemoteLiveCatchup(socketId, 'updateend');

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
    stopRemoteLatencyMonitor(socketId);
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
        videoEl.playbackRate = 1.0;
        videoEl.src = '';
        videoEl.removeAttribute('src');
        videoEl.load();
      }
    }
    delete mediaSourcesRef.current[socketId];
    delete sourceBuffersRef.current[socketId];
    delete chunkQueueRef.current[socketId];
    delete remoteMimeTypesRef.current[socketId];
    const blockedVideoUserId = socketIdToUserIdMap.current[socketId];
    const videoElement = blockedVideoUserId ? remoteVideoRefs.current[blockedVideoUserId] : undefined;
    if (videoElement) {
      remoteVideosAwaitingUserGestureRef.current.delete(videoElement);
    }

    // Clear cached URL so we don't reuse a revoked one
    if (mediaSourceUrlsRef.current[socketId]) {
      delete mediaSourceUrlsRef.current[socketId];
    }
  };


  const initializeMediaStream = async (initialVideoOn: boolean = false, initialMuted: boolean = true, isInitial: boolean = false) => {
    if (!isBroadcastPresenterRef.current) {
      stopLocalBroadcast();
      return;
    }

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

      const outgoingStream = createOutgoingStream(stream);
      if (outgoingStream) setupMediaRecorder(outgoingStream);

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
    if (!isBroadcastPresenterRef.current) return;

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
      const outgoingStream = createOutgoingStream();
      if (outgoingStream) setupMediaRecorder(outgoingStream);
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
    if (!isBroadcastPresenterRef.current) return;

    if (isScreenSharing) {
      // Stop screen sharing safely (prevent recursive onended loop)
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => {
          track.onended = null; // Disable event listener before stopping manually
          track.stop();
        });
      }
      screenStreamRef.current = null;
      isScreenSharingRef.current = false;
      setIsScreenSharing(false);

      // Restore camera stream
      if (localStreamRef.current) {
        const outgoingStream = createOutgoingStream();
        if (outgoingStream) setupMediaRecorder(outgoingStream);

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
        isScreenSharingRef.current = true;
        setIsScreenSharing(true);

        // Handle browser's "Stop Sharing" button
        screenStream.getVideoTracks()[0].onended = () => {
          toggleScreenShare(); // Recurse to stop and restore
        };

        const outgoingStream = createOutgoingStream(screenStream);
        if (outgoingStream) setupMediaRecorder(outgoingStream);

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
    if (!isBroadcastPresenterRef.current) return;

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

  const showSystemNotice = (message: string) => {
    if (systemNoticeTimeoutRef.current) {
      clearTimeout(systemNoticeTimeoutRef.current);
    }
    setSystemNotice(message);
    systemNoticeTimeoutRef.current = setTimeout(() => {
      setSystemNotice('');
      systemNoticeTimeoutRef.current = null;
    }, 2400);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setIsLinkCopied(true);
      showSystemNotice('회의 링크를 복사했습니다.');
      setTimeout(() => {
        setIsLinkCopied(false);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy meeting link:', error);
      showSystemNotice('링크 복사에 실패했습니다.');
    }
  };

  useEffect(() => {
    return () => {
      if (systemNoticeTimeoutRef.current) clearTimeout(systemNoticeTimeoutRef.current);
    };
  }, []);

  const leaveRoom = () => {
    console.log('Client: Leaving room');
    stopSubtitleAudioStreaming();
    socketRef.current?.emit('subtitle-stt-stop', { roomId });
    mediaRecorderRef.current?.stop();
    localStreamRef.current?.getTracks().forEach(track => track.stop());

    closeAudioContext();

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

  const endMeetingAndDeleteRoom = async () => {
    if (!isHost || isEndingMeeting) return;

    console.log('Client: Ending meeting and deleting room');
    setIsEndingMeeting(true);
    stopSubtitleAudioStreaming();
    socketRef.current?.emit('subtitle-stt-stop', { roomId });
    mediaRecorderRef.current?.stop();
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    closeAudioContext();

    try {
      const response = await fetch(`/api/meeting/${roomId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to delete meeting');
      }

      socketRef.current?.disconnect();
      router.push('/');
    } catch (error) {
      console.error('Failed to end meeting:', error);
      showSystemNotice('회의방 삭제에 실패했습니다.');
      setIsEndingMeeting(false);
    }
  };

  const handleEndCallClick = () => {
    if (exitImmediately) {
      if (isHost && deleteRoomOnHostEnd) {
        void endMeetingAndDeleteRoom();
      } else {
        leaveRoom();
      }
    } else {
      setShowEndCallModal(true);
    }
  };

  const handleExitImmediatelyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.checked;
    setExitImmediately(newValue);
    localStorage.setItem('exitImmediately', String(newValue));
  };

  const handleDeleteRoomOnHostEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.checked;
    setDeleteRoomOnHostEnd(newValue);
    localStorage.setItem('deleteRoomOnHostEnd', String(newValue));
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
    setShowControls(true);
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
  };

  const setBroadcastPresenter = (targetUserId: string) => {
    if (!isHost || !socketRef.current?.connected) return;

    socketRef.current.emit('set-broadcast-presenter', {
      roomId,
      targetUserId,
    });
  };

  const setRoomBroadcastMode = (mode: BroadcastMode) => {
    if (!isHost || !socketRef.current?.connected) return;
    socketRef.current.emit('set-broadcast-mode', {
      roomId,
      mode,
    });
  };

  const setSttSaving = (enabled: boolean) => {
    if (!isHost || !socketRef.current?.connected || isSttSavingUpdating) return;
    setIsSttSavingUpdating(true);
    socketRef.current.emit('set-stt-saving', {
      roomId,
      enabled,
    });
  };

  const revokeBroadcastPresenter = (targetUserId: string) => {
    if (!isHost || !socketRef.current?.connected || targetUserId === currentUserId) return;
    setBroadcastPresenter(currentUserId);
  };

  const stopControlsClickThrough = (event: SyntheticEvent) => {
    event.stopPropagation();
    setShowControls(true);
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
  };

  // Auto-hide controls logic
  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isHoveringControlsRef = useRef(false);
  const hasOpenModalPanel = showParticipantsPanel || showMorePanel || showEndCallModal;

  const resetControlsTimer = useCallback(() => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
    }
    if (hasOpenModalPanel) {
      setShowControls(true);
      return;
    }
    autoHideTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  }, [hasOpenModalPanel]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, [resetControlsTimer]);

  useEffect(() => {
    if (!hasOpenModalPanel) return;
    setShowControls(true);
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
  }, [hasOpenModalPanel]);

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (showEndCallModal) {
        setShowEndCallModal(false);
      } else if (showMorePanel) {
        setShowMorePanel(false);
      } else if (showParticipantsPanel) {
        setShowParticipantsPanel(false);
      } else if (showChatPanel) {
        setShowChatPanel(false);
      }
    };

    window.addEventListener('keydown', handleEscapeKey);
    return () => window.removeEventListener('keydown', handleEscapeKey);
  }, [showChatPanel, showEndCallModal, showMorePanel, showParticipantsPanel]);

  // Remote media latency is corrected both on MediaSource updateend and on a
  // periodic monitor so playback does not drift when update events slow down.




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

        playRemoteVideo(el, userId);
      } else {
        if (socketId && chunkQueueRef.current[socketId]?.length > 0) {
          setupMediaSource(userId, socketId, remoteMimeTypesRef.current[socketId]);
        } else {
          console.warn(`[VideoRef] No MediaSource found for ${userId} (socketId: ${socketId})`);
        }
      }
    }
  }, [selectedAudioOutputDeviceId]);

  // --- Render Logic ---
  const localParticipant = { userId: currentUserId, username: 'Me', isMuted, hasVideo: localVideoOn, isLocal: true, canBroadcast: isBroadcastPresenter };
  const pinnedParticipant = participants.find(p => p.userId === pinnedUserId) || (pinnedUserId === currentUserId ? localParticipant : null);
  const mainSpeaker = pinnedParticipant || participants[0] || localParticipant; // Default to first remote user, or Me if alone
  const shouldShowSubtitles = subtitles.length > 0 && (isSubtitlesEnabled || !isBroadcastPresenter);
  const selectedSubtitleLangs = new Set(subtitleLangs);

  const getParticipantReactions = (userId: string) => reactions.filter(reaction => reaction.userId === userId);
  const getSpeakerAction = (participant: Participant) => {
    if (!isHost || broadcastMode === 'all') return undefined;
    if (participant.userId === currentUserId) return isBroadcastPresenter ? undefined : 'make' as const;
    return participant.canBroadcast ? 'revoke' as const : 'make' as const;
  };
  const getSpeakerActionLabel = (participant: Participant) => {
    const action = getSpeakerAction(participant);
    if (!action) return undefined;
    if (participant.userId === currentUserId) return '내가 화자 되기';
    return action === 'revoke' ? '화자 권한 뺐기' : '화자 권한 주기';
  };
  const handleSpeakerAction = (targetUserId: string) => {
    const isCurrentPresenter = targetUserId === currentUserId
      ? isBroadcastPresenter
      : participants.some(participant => participant.userId === targetUserId && participant.canBroadcast);

    if (isCurrentPresenter && targetUserId !== currentUserId) {
      revokeBroadcastPresenter(targetUserId);
      return;
    }

    setBroadcastPresenter(targetUserId);
  };
  const formatSubtitleTime = (timestamp?: number) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleTimeString('ko-KR', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };
  const toggleSubtitleLang = (lang: SubtitleLang) => {
    setSubtitleLangs(prev => {
      if (prev.includes(lang)) {
        return prev.length === 1 ? prev : prev.filter(item => item !== lang);
      }
      return [...prev, lang];
    });
  };
  const allParticipants = [localParticipant, ...participants.filter(p => p.userId !== currentUserId)];
  const remoteParticipants = allParticipants.filter(p => p.userId !== mainSpeaker.userId);
  const presenterCount = allParticipants.filter(p => p.canBroadcast).length;
  const subtitleLanguageLabels: Record<SubtitleLang, string> = {
    ko: '한국어',
    en: '영어',
    ja: '일본어',
    zh: '중국어',
  };

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-zinc-950 text-foreground"
      onClick={() => {
        if (hasOpenModalPanel) {
          setShowControls(true);
          if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
          return;
        }
        if (showControls) {
          setShowControls(false);
          if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
        } else {
          setShowControls(true);
          resetControlsTimer();
        }
      }}
      onMouseMove={() => {
        if (showControls && !hasOpenModalPanel) {
          resetControlsTimer();
        }
      }}
    >
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed left-1/2 top-4 z-[70] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full border border-white/10 bg-zinc-950/92 px-4 py-2 text-sm font-medium text-white shadow-2xl shadow-black/35 backdrop-blur-md transition-all duration-200",
          systemNotice ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"
        )}
      >
        {systemNotice}
      </div>
      <div className="relative flex h-full flex-1 flex-col overflow-hidden md:flex-row">
        <main className="group relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(39,39,42,0.95),rgba(9,9,11,1)_42%)] p-3 pb-20 transition-all duration-300 md:p-4 md:pb-4">

          <div
            onMouseEnter={handleControlsMouseEnter}
            onMouseLeave={handleControlsMouseLeave}
            role="toolbar"
            aria-label="회의 컨트롤"
            className={cn(
              "absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-3 p-3 transition-all duration-500 ease-out md:p-5",
              showControls ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Meeting Info */}
            <div className="flex max-w-[calc(100vw-8rem)] items-center gap-3 rounded-2xl border border-white/10 bg-black/45 p-2.5 text-white shadow-lg backdrop-blur-xl md:max-w-none md:p-3">
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
                      className={cn("font-semibold text-sm tracking-wide md:text-base", isHost && "cursor-pointer hover:underline decoration-dashed underline-offset-4")}
                      title={isHost ? "회의 제목 수정" : undefined}
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
                <span className="mt-0.5 hidden font-mono text-[10px] tracking-wider text-white/50 md:block">ID: {roomId}</span>
              </div>
              <div className="hidden h-8 w-px bg-white/10 md:block" />
              <div className="hidden items-center gap-1.5 md:flex">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium text-white/75">
                  <Users className="h-3.5 w-3.5" />
                  {participants.length + 1}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-200">
                  <Radio className="h-3.5 w-3.5" />
                  {broadcastMode === 'all' ? '전체 화자' : `${presenterCount || 1}명 화자`}
                </span>
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
                <Maximize className="w-4 h-4 md:mr-2" /> <span className="hidden text-sm font-medium md:inline">발표자</span>
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
                <LayoutGrid className="w-4 h-4 md:mr-2" /> <span className="hidden text-sm font-medium md:inline">갤러리</span>
              </Button>
            </div>
          </div>

          {/* Main Video Area */}
          <div className="flex h-full min-h-0 w-full flex-col p-1 pt-14 md:p-3 md:pt-14">

            {layoutMode === 'grid' ? (
              /* --- GRID VIEW (Smart Grid) --- */
              <div className="flex h-full w-full flex-1 flex-wrap content-center justify-center gap-2 overflow-y-auto p-1 md:gap-3 md:p-2">
                {allParticipants.map((p, index, array) => {
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
                        reactions={getParticipantReactions(p.userId)}
                        speakerAction={getSpeakerAction(p)}
                        speakerActionLabel={getSpeakerActionLabel(p)}
                        onSpeakerAction={handleSpeakerAction}
                        className="h-full w-full bg-black/40 shadow-lg"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              /* --- SPEAKER VIEW (Filmstrip) --- */
              <div className="flex-1 flex flex-col w-full h-full overflow-hidden gap-2">
                {/* Main Stage (Active Speaker) */}
                <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-2xl">
                  <ParticipantCard
                    participant={mainSpeaker}
                    isLocal={mainSpeaker.userId === currentUserId}
                    localStream={mainSpeaker.userId === currentUserId ? localStreamRef.current : undefined}
                    localVideoOn={mainSpeaker.userId === currentUserId ? localVideoOn : undefined}
                    onRemoteVideoRef={mainSpeaker.userId !== currentUserId ? handleRemoteVideoRef : undefined}
                    isPinned={pinnedUserId === mainSpeaker.userId}
                    onPin={() => setPinnedUserId(pinnedUserId === mainSpeaker.userId ? null : mainSpeaker.userId)}
                    isSpeaking={speakingParticipants.has(mainSpeaker.userId)}
                    reactions={getParticipantReactions(mainSpeaker.userId)}
                    speakerAction={getSpeakerAction(mainSpeaker)}
                    speakerActionLabel={getSpeakerActionLabel(mainSpeaker)}
                    onSpeakerAction={handleSpeakerAction}
                    className="h-full w-full"
                  />
                </div>

                {/* Filmstrip (Other Participants) */}
                {remoteParticipants.length > 0 && (
                <div className="h-24 flex-shrink-0 snap-x overflow-x-auto overflow-y-hidden px-1 pb-2 md:h-32">
                  <div className="flex h-full gap-2">
                  {remoteParticipants.map(p => (
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
                          reactions={getParticipantReactions(p.userId)}
                          speakerAction={getSpeakerAction(p)}
                          speakerActionLabel={getSpeakerActionLabel(p)}
                          onSpeakerAction={handleSpeakerAction}
                          className="h-full w-full border border-white/10 transition-all hover:border-primary/60"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                )}
              </div>
            )}
          </div>

          {/* Subtitles Overlay */}
          {shouldShowSubtitles && (
            <div className="pointer-events-none absolute bottom-32 left-0 right-0 z-40 flex flex-col items-center justify-end gap-2 px-3 md:px-6">
              {subtitles.map((sub) => (
                <div key={sub.id} className="w-full max-w-3xl animate-in rounded-xl border border-white/10 bg-black/78 px-4 py-3 text-center shadow-2xl backdrop-blur-md slide-in-from-bottom-2 fade-in duration-300">
                  <div className="mb-2 flex flex-wrap items-center justify-center gap-2 text-[11px]">
                    <span className="font-semibold text-blue-200">{sub.userName}</span>
                    {typeof sub.latencyMs === 'number' && (
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 font-mono font-semibold text-emerald-200">
                        {sub.latencyMs}ms
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 font-mono text-white/45">
                      <Clock3 className="h-3 w-3" />
                      {formatSubtitleTime(sub.translationStartedAt)} - {formatSubtitleTime(sub.translationFinishedAt)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {selectedSubtitleLangs.has('ko') && (
                      <p className="text-sm font-medium leading-snug text-white drop-shadow-md md:text-base">KO {sub.ko}</p>
                    )}
                    {selectedSubtitleLangs.has('en') && (
                      <p className="text-sm font-medium leading-snug text-yellow-200 drop-shadow-md md:text-base">EN {sub.en}</p>
                    )}
                    {selectedSubtitleLangs.has('ja') && (
                      <p className="text-sm font-medium leading-snug text-emerald-200 drop-shadow-md md:text-base">JA {sub.ja}</p>
                    )}
                    {selectedSubtitleLangs.has('zh') && (
                      <p className="text-sm font-medium leading-snug text-rose-200 drop-shadow-md md:text-base">ZH {sub.zh}</p>
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
          )}
            onMouseEnter={handleControlsMouseEnter}
            onMouseLeave={handleControlsMouseLeave}
            onClick={stopControlsClickThrough}
            onClickCapture={stopControlsClickThrough}
            onMouseDown={stopControlsClickThrough}
            onMouseDownCapture={stopControlsClickThrough}
            onPointerDown={stopControlsClickThrough}
            onPointerDownCapture={stopControlsClickThrough}
          >
            <ReactionBar onReaction={(emoji) => {
              handleSendReaction(emoji);
            }} />
          </div>

          {/* Floating Control Bar */}
          <div
            onMouseEnter={handleControlsMouseEnter}
            onMouseLeave={handleControlsMouseLeave}
            className={cn(
              "fixed z-50 flex items-center justify-center gap-1 shadow-2xl transition-all duration-500 ease-out md:gap-2",
              // Mobile Styles: Bottom fixed
              "bottom-4 left-4 right-4 h-auto rounded-2xl border border-white/10 bg-black/82 px-2 py-2 backdrop-blur-xl",
              // Desktop Styles: Floating pill, centered
              "md:bottom-8 md:left-1/2 md:w-auto md:-translate-x-1/2 md:transform md:rounded-3xl md:bg-zinc-900/92 md:px-4 md:py-2",
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
                  isMuted && "text-red-500 hover:bg-red-500/10 hover:text-red-400",
                  !isBroadcastPresenter && "opacity-45 cursor-not-allowed hover:bg-transparent"
                )}
                disabled={!isBroadcastPresenter}
                onClick={toggleMute}
                aria-label={isBroadcastPresenter ? (isMuted ? '마이크 켜기' : '마이크 끄기') : '수신 전용 참가자입니다'}
                aria-pressed={!isMuted}
                title={isBroadcastPresenter ? undefined : "Receive-only attendee"}
              >
                {isMuted ? <MicOff className="w-5 h-5 md:w-6 md:h-6 mb-1" /> : <Mic className="w-5 h-5 md:w-6 md:h-6 mb-1" />}
                <span className="text-[10px] font-medium md:text-xs">{isBroadcastPresenter ? (isMuted ? '마이크 켜기' : '마이크 끄기') : '수신'}</span>
              </Button>

              <Button
                variant="ghost"
                className={cn(
                  "flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-xl hover:bg-white/10 text-white transition-all",
                  !localVideoOn && "text-red-500 hover:bg-red-500/10 hover:text-red-400",
                  !isBroadcastPresenter && "opacity-45 cursor-not-allowed hover:bg-transparent"
                )}
                disabled={!isBroadcastPresenter}
                onClick={toggleCamera}
                aria-label={isBroadcastPresenter ? (localVideoOn ? '카메라 끄기' : '카메라 켜기') : '수신 전용 참가자입니다'}
                aria-pressed={localVideoOn}
                title={isBroadcastPresenter ? undefined : "Receive-only attendee"}
              >
                {localVideoOn ? <Video className="w-5 h-5 md:w-6 md:h-6 mb-1" /> : <VideoOff className="w-5 h-5 md:w-6 md:h-6 mb-1" />}
                <span className="text-[10px] font-medium md:text-xs">{isBroadcastPresenter ? (localVideoOn ? '카메라 끄기' : '카메라 켜기') : '보기'}</span>
              </Button>

              <Button
                variant="ghost"
                className={cn(
                  "flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-xl hover:bg-white/10 text-white transition-all",
                  isScreenSharing && "text-blue-400 bg-white/10",
                  !isBroadcastPresenter && "opacity-45 cursor-not-allowed hover:bg-transparent"
                )}
                disabled={!isBroadcastPresenter}
                onClick={toggleScreenShare}
                aria-label={isBroadcastPresenter ? (isScreenSharing ? '화면 공유 중지' : '화면 공유 시작') : '수신 전용 참가자입니다'}
                aria-pressed={isScreenSharing}
                title={isBroadcastPresenter ? undefined : "Receive-only attendee"}
              >
                <MonitorUp className="w-5 h-5 md:w-6 md:h-6 mb-1" />
                <span className="text-[10px] font-medium md:text-xs">{isBroadcastPresenter ? (isScreenSharing ? '공유 중지' : '화면 공유') : '수신'}</span>
              </Button>

              <div className="relative group">
                <Button
                  variant="ghost"
                  className={cn(
                    "flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-xl hover:bg-white/10 text-white transition-all",
                    isSubtitlesEnabled && "text-yellow-400 bg-white/10"
                  )}
                  onClick={() => setIsSubtitlesEnabled(!isSubtitlesEnabled)}
                  aria-label={isSubtitlesEnabled ? '자막 끄기' : '자막 켜기'}
                  aria-pressed={isSubtitlesEnabled}
                >
                  <Subtitles className="w-5 h-5 md:w-6 md:h-6 mb-1" />
                  <span className="text-[10px] font-medium md:text-xs">자막</span>
                </Button>
                
                {/* Language Selector Popup (Visible on Hover when CC is active) */}
                {isSubtitlesEnabled && (
                  <div className="absolute bottom-full left-1/2 z-50 mb-2 flex -translate-x-1/2 flex-col gap-3 rounded-xl border border-white/10 bg-black/92 p-3 opacity-0 shadow-xl backdrop-blur-md transition-opacity group-hover:opacity-100 whitespace-nowrap">
                    {/* View Language */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-gray-400 font-bold px-1 mb-0.5">번역 자막 선택</span>
                      <div className="grid grid-cols-4 gap-1">
                        {(['ko', 'en', 'ja', 'zh'] as SubtitleLang[]).map((lang) => (
                          <button
                            key={'view-' + lang}
                            className={cn(
                              "flex-1 rounded px-2.5 py-1 text-center text-xs font-bold uppercase transition-colors hover:bg-white/20",
                              subtitleLangs.includes(lang) ? "bg-primary text-white" : "text-gray-300 bg-white/5"
                            )}
                            onClick={(e) => { e.stopPropagation(); toggleSubtitleLang(lang); }}
                            title={subtitleLanguageLabels[lang]}
                          >
                            {lang}
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
                              "flex-1 rounded px-2.5 py-1 text-center text-xs font-bold uppercase transition-colors hover:bg-white/20",
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
                aria-label="참가자 패널 열기"
                aria-expanded={showParticipantsPanel}
              >
                <Users className="w-5 h-5 md:w-6 md:h-6 mb-1" />
                <span className="hidden text-[10px] font-medium md:block md:text-xs">참가자</span>
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
                aria-label={showChatPanel ? '채팅 닫기' : '채팅 열기'}
                aria-expanded={showChatPanel}
              >
                <MessageSquare className="w-5 h-5 md:w-6 md:h-6 mb-1" />
                <span className="hidden text-[10px] font-medium md:block md:text-xs">채팅</span>
              </Button>

              <Button
                variant="ghost"
                className="flex flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-xl hover:bg-white/10 text-white transition-all"
                onClick={() => setShowMorePanel(true)}
                aria-label="회의 설정 열기"
                aria-expanded={showMorePanel}
              >
                <Settings className="w-5 h-5 md:w-6 md:h-6 mb-1" />
                <span className="hidden text-[10px] font-medium md:block md:text-xs">설정</span>
              </Button>
            </div>

            {/* End Call */}
            <div className="pl-2 md:pl-4 ml-1 md:ml-2 border-l border-white/10 flex items-center">
              <Button
                variant="destructive"
                className="rounded-xl md:rounded-2xl px-4 md:px-6 h-10 md:h-14 font-semibold shadow-lg shadow-red-500/20 hover:shadow-red-500/40 text-sm md:text-base flex items-center gap-2"
                onClick={handleEndCallClick}
                aria-label="회의 종료"
              >
                종료
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

        {/* Participants Panel */}
        {
          showParticipantsPanel && (
            <div
              className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm"
              onClick={(event) => {
                event.stopPropagation();
                setShowParticipantsPanel(false);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="participants-panel-title"
                className="absolute bottom-0 right-0 top-auto flex max-h-[82vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-zinc-950 text-white shadow-2xl md:bottom-auto md:top-0 md:h-full md:max-h-none md:w-[400px] md:rounded-none md:border-l"
                onClick={e => e.stopPropagation()}
              >
                <div className="border-b border-white/10 p-5">
                  <div className="flex items-start justify-between gap-4">
                  <div>
                      <h3 id="participants-panel-title" className="text-lg font-bold">참가자</h3>
                      <p className="mt-1 text-xs text-white/50">
                        {participants.length + 1}명 참여 중 · {broadcastMode === 'all' ? '전체 화자 모드' : '단일 화자 모드'}
                      </p>
                  </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setShowParticipantsPanel(false)} aria-label="참가자 패널 닫기">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {broadcastMode === 'all' && (
                    <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                      모든 참가자가 마이크와 카메라를 송출할 수 있습니다.
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-4">
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold">
                        {session?.user?.name?.[0]?.toUpperCase() || 'ME'}
                      </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium">{session?.user?.name || 'Me'} (나)</span>
                            {hostId === currentUserId && <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-200"><Crown className="h-3 w-3" />방장</span>}
                            {isBroadcastPresenter && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200"><Radio className="h-3 w-3" />화자</span>}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2 text-xs text-white/50">
                            {isMuted ? <MicOff className="h-3.5 w-3.5 text-red-300" /> : <Mic className="h-3.5 w-3.5 text-emerald-300" />}
                            {localVideoOn ? <Video className="h-3.5 w-3.5 text-emerald-300" /> : <VideoOff className="h-3.5 w-3.5 text-red-300" />}
                          </div>
                        </div>
                      </div>
                      {isHost && broadcastMode === 'single' && !isBroadcastPresenter && (
                        <Button size="sm" variant="secondary" className="shrink-0 rounded-full" onClick={() => setBroadcastPresenter(currentUserId)}>
                          내가 화자
                        </Button>
                      )}
                        </div>
                      </div>

                  {participants.map(p => (
                    <div key={p.userId} className="rounded-xl border border-white/10 bg-white/[0.025] p-3 transition-colors hover:bg-white/[0.06]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                        {p.avatar_url ? (
                            <Image src={p.avatar_url} alt={p.username} width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" />
                        ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold">
                            {p.username?.[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate font-medium">{p.username}</span>
                              {hostId === p.userId && <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-200"><Crown className="h-3 w-3" />방장</span>}
                              {p.canBroadcast && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200"><Radio className="h-3 w-3" />화자</span>}
                          </div>
                            <div className="mt-1.5 flex items-center gap-2 text-xs text-white/50">
                              {p.isMuted ? <MicOff className="h-3.5 w-3.5 text-red-300" /> : <Mic className="h-3.5 w-3.5 text-emerald-300" />}
                              {p.hasVideo ? <Video className="h-3.5 w-3.5 text-emerald-300" /> : <VideoOff className="h-3.5 w-3.5 text-red-300" />}
                          </div>
                        </div>
                      </div>
                        {isHost && broadcastMode === 'single' && (
                          <Button
                            size="sm"
                            variant={p.canBroadcast ? "destructive" : "secondary"}
                            className="shrink-0 rounded-full"
                            onClick={() => p.canBroadcast ? revokeBroadcastPresenter(p.userId) : setBroadcastPresenter(p.userId)}
                          >
                            {p.canBroadcast ? '권한 뺐기' : '화자 주기'}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        }

        {/* Settings Panel */}
        {
          showMorePanel && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
              onClick={(event) => {
                event.stopPropagation();
                setShowMorePanel(false);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-panel-title"
                className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 text-white shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-white/10 p-5">
                  <div>
                    <h3 id="settings-panel-title" className="text-lg font-bold">회의 설정</h3>
                    <p className="mt-1 text-xs text-white/50">화자 모드, 장치, 자막 지연 상태를 조정합니다.</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setShowMorePanel(false)} aria-label="회의 설정 닫기">
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                  {isHost && (
                    <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-bold">
                            <Radio className="h-4 w-4 text-emerald-300" />
                            화자 모드
                          </div>
                          <div className="mt-1 text-xs text-white/50">
                            {broadcastMode === 'all'
                              ? '모든 참가자가 영상과 음성을 송출할 수 있습니다.'
                              : '방장이 지정한 한 명만 영상과 음성을 송출합니다.'}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/30 p-1">
                          <button
                            type="button"
                            className={cn(
                              "rounded-lg px-4 py-2 text-xs font-semibold transition-colors",
                              broadcastMode === 'single' ? "bg-white text-zinc-950" : "text-white/55 hover:text-white"
                            )}
                            onClick={() => setRoomBroadcastMode('single')}
                          >
                            단일
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "rounded-lg px-4 py-2 text-xs font-semibold transition-colors",
                              broadcastMode === 'all' ? "bg-white text-zinc-950" : "text-white/55 hover:text-white"
                            )}
                            onClick={() => setRoomBroadcastMode('all')}
                          >
                            전체
                          </button>
                        </div>
                      </div>
                    </section>
                  )}

                  {isHost && (
                    <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-bold">
                            <Subtitles className="h-4 w-4 text-emerald-300" />
                            STT 기록
                          </div>
                          <div className="mt-1 text-xs text-white/50">
                            {isSttSaved
                              ? '지금부터 확정된 자막 내용을 데이터베이스에 저장 중입니다.'
                              : '버튼을 누른 이후의 확정 자막만 데이터베이스에 저장합니다.'}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={isSttSaved ? "destructive" : "secondary"}
                          className="shrink-0 rounded-full"
                          disabled={isSttSavingUpdating}
                          onClick={() => setSttSaving(!isSttSaved)}
                        >
                          {isSttSavingUpdating ? '변경 중...' : isSttSaved ? '기록 중지' : '이때부터 기록 시작'}
                        </Button>
                      </div>
                    </section>
                  )}

                  <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                      <Settings className="h-4 w-4 text-blue-300" />
                      장치
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="space-y-1.5 text-xs text-white/55">
                        카메라
                        <select className="w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white" value={selectedVideoDeviceId || ''} onChange={(e) => setSelectedVideoDeviceId(e.target.value)}>
                          {availableVideoDevices.map(device => (
                            <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${device.deviceId}`}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1.5 text-xs text-white/55">
                        마이크
                        <select className="w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white" value={selectedAudioInputDeviceId || ''} onChange={(e) => setSelectedAudioInputDeviceId(e.target.value)}>
                          {availableAudioInputDevices.map(device => (
                            <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${device.deviceId}`}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1.5 text-xs text-white/55">
                        스피커
                        <select className="w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white" value={selectedAudioOutputDeviceId || ''} onChange={(e) => setSelectedAudioOutputDeviceId(e.target.value)}>
                          {availableAudioOutputDevices.map(device => (
                            <option key={device.deviceId} value={device.deviceId}>{device.label || `Speaker ${device.deviceId}`}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </section>

                  <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                      <Volume2 className="h-4 w-4 text-indigo-300" />
                      오디오
                    </div>
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="flex items-center justify-between rounded-lg bg-black/25 px-3 py-2 text-sm">
                          잡음 제거
                          <input type="checkbox" className="h-4 w-4 accent-blue-500" checked={noiseSuppression} onChange={(e) => setNoiseSuppression(e.target.checked)} />
                        </label>
                        <label className="flex items-center justify-between rounded-lg bg-black/25 px-3 py-2 text-sm">
                          에코 제거
                          <input type="checkbox" className="h-4 w-4 accent-blue-500" checked={echoCancellation} onChange={(e) => setEchoCancellation(e.target.checked)} />
                        </label>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-2 text-xs text-white/55">
                          마이크 볼륨 <span className="font-mono text-white/70">{(micVolume * 100).toFixed(0)}%</span>
                          <input type="range" min="0" max="3" step="0.1" value={micVolume} onChange={(e) => setMicVolume(parseFloat(e.target.value))} className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/20 accent-blue-400" />
                        </label>
                        <label className="space-y-2 text-xs text-white/55">
                          스피커 볼륨 <span className="font-mono text-white/70">{(volume * 100).toFixed(0)}%</span>
                          <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/20 accent-blue-400" />
                        </label>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold">나가기 확인 생략</div>
                        <div className="mt-1 text-xs text-white/50">종료 버튼을 누르면 바로 회의방을 나갑니다.</div>
                      </div>
                      <input type="checkbox" className="h-5 w-5 accent-blue-500" checked={exitImmediately} onChange={handleExitImmediatelyChange} />
                    </div>
                  </section>

                  {isHost && (
                    <section className="rounded-xl border border-red-400/20 bg-red-500/[0.08] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-bold text-red-100">
                            <Trash2 className="h-4 w-4 text-red-300" />
                            종료 시 회의방 삭제
                          </div>
                          <div className="mt-1 text-xs text-red-100/60">
                            방장이 종료 버튼을 누르면 참가자를 내보내고 회의방 DB 기록을 삭제합니다.
                          </div>
                        </div>
                        <input type="checkbox" className="h-5 w-5 accent-red-500" checked={deleteRoomOnHostEnd} onChange={handleDeleteRoomOnHostEndChange} />
                      </div>
                    </section>
                  )}

                  {latencyHistory.length > 0 && (
                    <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-bold">
                          <Activity className="h-4 w-4 text-emerald-300" />
                          자막 지연시간
                        </span>
                        <button
                          className="text-xs text-white/50 transition-colors hover:text-red-300"
                          onClick={() => setLatencyHistory([])}
                        >
                          초기화
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div className="rounded-lg bg-black/25 p-2 text-center">
                          <div className="text-lg font-bold text-green-400">
                            {Math.round(latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length)}ms
                          </div>
                          <div className="text-[10px] text-white/45">평균</div>
                        </div>
                        <div className="rounded-lg bg-black/25 p-2 text-center">
                          <div className="text-lg font-bold text-blue-400">
                            {Math.min(...latencyHistory)}ms
                          </div>
                          <div className="text-[10px] text-white/45">최소</div>
                        </div>
                        <div className="rounded-lg bg-black/25 p-2 text-center">
                          <div className="text-lg font-bold text-orange-400">
                            {Math.max(...latencyHistory)}ms
                          </div>
                          <div className="text-[10px] text-white/45">최대</div>
                        </div>
                      </div>

                      <div className="mt-3 flex h-10 items-end gap-0.5 rounded bg-black/25 p-1">
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
                      <div className="mt-2 flex justify-between text-[10px] text-white/45">
                        <span>최근 {latencyHistory.length}회 측정</span>
                        <span>&lt;1s / 1~2s / &gt;2s</span>
                      </div>
                    </section>
                  )}

                  <Button className="mt-1 w-full gap-2 rounded-xl" onClick={copyLink}>
                    {isLinkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {isLinkCopied ? '링크 복사됨' : '회의 링크 복사'}
                  </Button>
                </div>
              </div>
            </div>
          )
        }

        {/* End Call Modal */}
        {
          showEndCallModal && (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center" onClick={(event) => event.stopPropagation()}>
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="end-call-title"
                aria-describedby="end-call-description"
                className="bg-card p-6 rounded-xl shadow-2xl max-w-sm w-full mx-4 border"
              >
                <h3 id="end-call-title" className="text-lg font-bold mb-2">
                  {isHost && deleteRoomOnHostEnd ? '회의방을 삭제하고 종료할까요?' : '회의를 나갈까요?'}
                </h3>
                <p id="end-call-description" className="text-muted-foreground mb-6">
                  {isHost && deleteRoomOnHostEnd
                    ? '모든 참가자가 내보내지고 이 회의방은 다시 참여할 수 없게 됩니다.'
                    : '현재 회의방에서 나갑니다. 다시 참여하려면 회의 링크가 필요합니다.'}
                </p>
                <div className="flex flex-wrap justify-end gap-3">
                  <Button variant="outline" onClick={() => setShowEndCallModal(false)} disabled={isEndingMeeting}>취소</Button>
                  {isHost && deleteRoomOnHostEnd && (
                    <Button variant="secondary" onClick={leaveRoom} disabled={isEndingMeeting}>나만 나가기</Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={isHost && deleteRoomOnHostEnd ? () => void endMeetingAndDeleteRoom() : leaveRoom}
                    disabled={isEndingMeeting}
                  >
                    {isEndingMeeting ? '종료 중...' : isHost && deleteRoomOnHostEnd ? '방 삭제하고 종료' : '나가기'}
                  </Button>
                </div>
              </div>
            </div>
          )
        }
      </div>
    </div>
  );
}
