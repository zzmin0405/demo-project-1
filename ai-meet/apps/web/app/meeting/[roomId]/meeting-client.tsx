'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { useSession } from "next-auth/react";
import Image from 'next/image';
import { Button } from "@/components/ui/button";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff,
  LayoutGrid, Maximize, Pin, PinOff,
  Users, MessageSquare, Settings, ChevronUp, ChevronDown, Edit2
} from 'lucide-react';
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChatPanel } from "@/components/meeting/chat-panel";
import { ReactionBar } from "@/components/meeting/reaction-bar";
import { ReactionOverlay, Reaction } from "@/components/meeting/reaction-overlay";
import { SettingsModal } from "@/components/meeting/settings-modal";

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

  const [meetingTitle, setMeetingTitle] = useState("Meeting Room");
  const [isHost, setIsHost] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Reaction State
  const [reactions, setReactions] = useState<Reaction[]>([]);

  // UI State
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('speaker');


  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showParticipantsPanel, setShowParticipantsPanel] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  // Chat State
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ userId: string; username: string; message: string; timestamp: string; avatar_url?: string }[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isHoveringRef = useRef(false);

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
  const localMimeTypeRef = useRef<string | null>(null);
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
          if (settings.joinMuted !== undefined) {
            setIsMuted(settings.joinMuted);
            isMutedRef.current = settings.joinMuted;
          }
          if (settings.joinVideoOff !== undefined) {
            const shouldBeOn = !settings.joinVideoOff;
            setLocalVideoOn(shouldBeOn);
            localVideoOnRef.current = shouldBeOn;
          }
        } catch (e) {
          console.error("Failed to parse meeting settings", e);
        }
      }
    }
  }, [roomId]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, showChatPanel]);

  const setupMediaRecorder = (stream: MediaStream) => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
    if (socketRef.current && stream) {
      const options = { mimeType: 'video/webm; codecs=vp8,opus' };
      try {
        const mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            if (socketRef.current && socketRef.current.connected) {
              console.log('Sending media chunk:', event.data.size); // Uncomment for verbose logging
              socketRef.current.emit('media-chunk', event.data);
            } else {
              console.warn('Socket not connected, dropping media chunk');
            }
          }
        };

        mediaRecorder.onstart = () => console.log('MediaRecorder started');
        mediaRecorder.onstop = () => console.log('MediaRecorder stopped');
        mediaRecorder.onerror = (e) => console.error('MediaRecorder error:', e);

        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.start(100); // Send chunks every 100ms
        console.log('MediaRecorder initialized with mimeType:', options.mimeType);
      } catch (e) {
        console.error('MediaRecorder setup failed:', e);
      }
    }
  };

  const mimeTypesRef = useRef<{ [socketId: string]: string }>({});

  const processChunkQueue = async (socketId: string) => {
    const sourceBuffer = sourceBuffersRef.current[socketId];
    const mediaSource = mediaSourcesRef.current[socketId];

    if (sourceBuffer && !sourceBuffer.updating && mediaSource && mediaSource.readyState === 'open' && chunkQueueRef.current[socketId]?.length > 0) {
      const nextChunk = chunkQueueRef.current[socketId].shift();
      if (nextChunk) {
        try {
          sourceBuffer.appendBuffer(await nextChunk.arrayBuffer());
        } catch (e) {
          // Ignore InvalidStateError during cleanup
        }
      }
    }
  };

  const setupSourceBufferListeners = (sourceBuffer: SourceBuffer, socketId: string, mediaSource: MediaSource) => {
    sourceBuffer.addEventListener('updateend', () => {
      processChunkQueue(socketId);
    });
  };

  const setupMediaSource = (userId: string, socketId: string, mimeType: string) => {
    if (mediaSourcesRef.current[socketId] || !remoteVideoRefs.current[userId]) {
      return;
    }
    console.log(`Setting up MediaSource for userId: ${userId}, socketId: ${socketId}, mimeType: ${mimeType}`);
    const mediaSource = new MediaSource();
    mediaSourcesRef.current[socketId] = mediaSource;
    const videoElement = remoteVideoRefs.current[userId];

    if (videoElement) {
      videoElement.src = URL.createObjectURL(mediaSource);
      // Ensure audio is played by unmuting remote video elements (except for local feedback if needed)
      videoElement.muted = false;
      videoElement.onloadedmetadata = () => {
        videoElement.play().catch(e => console.error("Autoplay failed", e));
      };
    }

    mediaSource.addEventListener('sourceopen', () => {
      console.log(`MediaSource opened for ${socketId}`);
      try {
        const mime = mimeType === 'default' || !mimeType ? 'video/webm; codecs="vp8, opus"' : mimeType;

        if (!MediaSource.isTypeSupported(mime)) {
          console.error(`${mime} is not supported by this browser.`);
          // Fallback logic could go here, but usually vp8,opus is supported
          return;
        }

        const sourceBuffer = mediaSource.addSourceBuffer(mime);
        sourceBuffersRef.current[socketId] = sourceBuffer;
        setupSourceBufferListeners(sourceBuffer, socketId, mediaSource);
        processChunkQueue(socketId);
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
        URL.revokeObjectURL(videoEl.src);
        videoEl.src = '';
        videoEl.removeAttribute('src');
      }
    }
    delete mediaSourcesRef.current[socketId];
    delete sourceBuffersRef.current[socketId];
    delete chunkQueueRef.current[socketId];
  };

  const initializeMediaStream = useCallback(async (requestVideo: boolean = false, requestMuted: boolean = true, isInitial: boolean = false) => {
    try {
      console.log(`Client: Initializing media stream (Video: ${requestVideo}, Initial: ${isInitial})...`);
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setAvailableVideoDevices(videoDevices);
      setAvailableAudioInputDevices(devices.filter(device => device.kind === 'audioinput'));
      setAvailableAudioOutputDevices(devices.filter(device => device.kind === 'audiooutput'));

      if (requestVideo && videoDevices.length === 0) {
        console.warn('No camera found. Falling back to audio-only.');
        requestVideo = false;
      }

      const videoConstraint: boolean | MediaTrackConstraints = requestVideo
        ? (selectedVideoDeviceId ? { deviceId: { exact: selectedVideoDeviceId } } : true)
        : false;

      const audioConstraint: boolean | MediaTrackConstraints = selectedAudioInputDeviceId
        ? { deviceId: { exact: selectedAudioInputDeviceId } }
        : true;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: audioConstraint
      });

      const AudioContextClass = window.AudioContext || (window as unknown as Window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const gainNode = audioContext.createGain();
      const destination = audioContext.createMediaStreamDestination();

      const targetMuted = isInitial ? requestMuted : isMuted;
      gainNode.gain.value = targetMuted ? 0 : micVolume;

      source.connect(gainNode);
      gainNode.connect(destination);

      audioContextRef.current = audioContext;
      gainNodeRef.current = gainNode;
      audioSourceRef.current = source;
      audioDestinationRef.current = destination;

      const processedAudioTrack = destination.stream.getAudioTracks()[0];
      const tracks = [processedAudioTrack];
      if (requestVideo) {
        tracks.unshift(...stream.getVideoTracks());
      }
      const mixedStream = new MediaStream(tracks);

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      setLocalStream(stream);
      localStreamRef.current = stream;
      setLocalVideoOn(requestVideo);
      console.log('Client: Media stream initialized.');

      setupMediaRecorder(mixedStream);

      if (requestVideo) {
        socketRef.current?.emit('camera-state-changed', {
          roomId,
          userId: session?.user?.email,
          hasVideo: true
        });
      }

      socketRef.current?.emit('mic-state-changed', {
        roomId,
        userId: session?.user?.email,
        isMuted: targetMuted
      });

    } catch (err) {
      console.error('Error accessing media devices:', err);
      if (err instanceof DOMException && err.name === 'NotReadableError') {
        console.log('Camera locked. Retrying in 1 second...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: selectedAudioInputDeviceId ? { deviceId: { exact: selectedAudioInputDeviceId } } : true
          });
          alert('카메라가 일시적으로 잠겨있습니다. 1초 뒤 다시 시도하거나 브라우저를 완전히 껐다 켜주세요.');
          return;
        } catch (retryErr) {
          console.error('Retry failed:', retryErr);
        }
      }

      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError') {
          alert('카메라/마이크 권한이 거부되었습니다. 브라우저 주소창의 자물쇠 아이콘을 클릭하여 권한을 허용해주세요.');
        } else if (err.name === 'NotReadableError') {
          if (!isInitial) alert('카메라 하드웨어 오류: 장치가 응답하지 않습니다.');
        } else if (err.name === 'NotFoundError') {
          if (!isInitial) alert('카메라/마이크를 찾을 수 없습니다.');
        } else {
          if (!isInitial) alert(`미디어 장치 오류: ${err.message}`);
        }
      } else {
        if (!isInitial) alert('미디어 장치에 접근할 수 없습니다.');
      }
    }
  }, [roomId, session, selectedVideoDeviceId, selectedAudioInputDeviceId, isMuted, micVolume]);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user) {
      router.push('/login');
      return;
    }

    if (isInitialized.current) return;
    isInitialized.current = true;

    const websocketUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'http://localhost:3002';
    const socket = io(websocketUrl, {
      autoConnect: false,
      withCredentials: false, // Explicitly disable credentials to match backend CORS
      extraHeaders: { 'ngrok-skip-browser-warning': 'true' },
      auth: { token: (session.user as { id?: string }).id || session.user.email },
    });
    socketRef.current = socket;

    const initialize = async () => {
      console.log('Client: Initializing...');
      const currentUserId = (session.user as { id?: string }).id || session.user?.email || 'unknown';
      const username = session.user?.name || session.user?.email || 'Anonymous';

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAvailableVideoDevices(devices.filter(device => device.kind === 'videoinput'));
        setAvailableAudioInputDevices(devices.filter(device => device.kind === 'audioinput'));
        setAvailableAudioOutputDevices(devices.filter(device => device.kind === 'audiooutput'));
      } catch (err) {
        console.error('Error enumerating devices:', err);
      }

      socket.connect();
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
        let initialVideoOn = false;
        let initialMuted = true;

        if (typeof window !== 'undefined') {
          const storedSettings = sessionStorage.getItem(`meeting-settings-${roomId}`);
          if (storedSettings) {
            try {
              const settings = JSON.parse(storedSettings);
              if (settings.joinVideoOff !== undefined) initialVideoOn = !settings.joinVideoOff;
              if (settings.joinMuted !== undefined) initialMuted = settings.joinMuted;
            } catch (e) {
              console.error("Failed to parse meeting settings", e);
            }
          }
        }

        initializeMediaStream(initialVideoOn, initialMuted, true); // isInitial = true
      });

      socket.on('room-state', async (data: { participants: (Participant & { socketId: string })[], title?: string, hostId?: string }) => {
        const filteredParticipants = data.participants.filter(p => p.userId !== currentUserId);
        if (data.title) setMeetingTitle(data.title);
        if (data.hostId && data.hostId === currentUserId) setIsHost(true);

        data.participants.forEach(p => {
          if (p.userId !== currentUserId) {
            socketIdToUserIdMap.current[p.socketId] = p.userId;
            userIdToSocketIdMap.current[p.userId] = p.socketId;
          }
        });
        setParticipants(filteredParticipants);
      });

      socket.on('user-joined', async (data: Participant & { socketId: string }) => {
        if (data.userId === currentUserId) return;
        socketIdToUserIdMap.current[data.socketId] = data.userId;
        userIdToSocketIdMap.current[data.userId] = data.socketId;
        setParticipants(prev => [...prev, data]);
      });

      socket.on('user-left', (data: { userId: string }) => {
        const socketId = userIdToSocketIdMap.current[data.userId];
        if (socketId) {
          cleanupMediaSource(socketId);
          delete socketIdToUserIdMap.current[socketId];
          delete userIdToSocketIdMap.current[data.userId];
        }
        setParticipants(prev => prev.filter(p => p.userId !== data.userId));
      });

      socket.on('media-chunk', async (data: { socketId: string, chunk: ArrayBuffer }) => {
        const { socketId, chunk } = data;
        console.log(`Received media chunk from ${socketId}, size: ${chunk.byteLength}`);
        const blob = new Blob([chunk], { type: 'video/webm' });
        const sourceBuffer = sourceBuffersRef.current[socketId];
        const mediaSource = mediaSourcesRef.current[socketId];

        if (sourceBuffer && !sourceBuffer.updating && mediaSource && mediaSource.readyState === 'open') {
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

      socket.on('chat-message', (data: { userId: string, username: string, message: string, timestamp: Date, avatar_url?: string }) => {
        console.log('[ChatDebug] Received chat-message:', data);
        setChatMessages(prev => [...prev, {
          ...data,
          timestamp: typeof data.timestamp === 'string' ? data.timestamp : new Date(data.timestamp).toISOString()
        }]);
      });
    };

    initialize();

    return () => {
      mediaRecorderRef.current?.stop();
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      if (audioContextRef.current) audioContextRef.current.close();
      Object.keys(mediaSourcesRef.current).forEach(socketId => cleanupMediaSource(socketId));
      socket.emit('leave-room');
      socket.disconnect();
      socketRef.current = null;
      socketIdToUserIdMap.current = {};
      setParticipants([]);
      isInitialized.current = false;
    };
  }, [roomId, router, session, status]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const toggleCamera = async () => {
    if (!localStreamRef.current) {
      await initializeMediaStream(true, isMuted, false);
      return;
    }

    const currentUserId = (session?.user as { id?: string })?.id || session?.user?.email;
    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setLocalVideoOn(videoTrack.enabled);
      localVideoOnRef.current = videoTrack.enabled;

      socketRef.current?.emit('camera-state-changed', {
        roomId,
        userId: currentUserId,
        hasVideo: videoTrack.enabled,
      });
    } else {
      try {
        const videoConstraint: boolean | MediaTrackConstraints = selectedVideoDeviceId
          ? { deviceId: { exact: selectedVideoDeviceId } }
          : true;

        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraint
        });
        const newVideoTrack = videoStream.getVideoTracks()[0];
        localStreamRef.current.addTrack(newVideoTrack);
        setLocalVideoOn(true);
        localVideoOnRef.current = true;

        if (audioDestinationRef.current) {
          const processedAudioTrack = audioDestinationRef.current.stream.getAudioTracks()[0];
          const mixedStream = new MediaStream([
            newVideoTrack,
            processedAudioTrack
          ]);
          setupMediaRecorder(mixedStream);
        }

        socketRef.current?.emit('camera-state-changed', {
          roomId,
          userId: currentUserId,
          hasVideo: true,
        });
      } catch (e) {
        console.error("Failed to add video track:", e);
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          alert('카메라 권한이 거부되었습니다. 설정에서 권한을 허용해주세요.');
        }
      }
    }
  };

  const toggleMute = async () => {
    let newMutedState = !isMuted;
    const currentUserId = (session?.user as { id?: string })?.id || session?.user?.email;

    if (!localStreamRef.current) {
      setIsMuted(false);
      isMutedRef.current = false;
      newMutedState = false;
      await initializeMediaStream(false, false, false);
    } else {
      if (localStreamRef.current) {
        if (gainNodeRef.current) {
          setIsMuted(newMutedState);
          isMutedRef.current = newMutedState;
          gainNodeRef.current.gain.value = newMutedState ? 0 : micVolume;
        } else {
          const audioTrack = localStreamRef.current.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            setIsMuted(!audioTrack.enabled);
            isMutedRef.current = !audioTrack.enabled;
            newMutedState = !audioTrack.enabled;
          }
        }
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

    if (socketRef.current?.connected) {
      const timeout = setTimeout(() => {
        console.log('Client: Leave Ack timed out, forcing disconnect');
        socketRef.current?.disconnect();
        router.push('/');
      }, 500);

      socketRef.current.emit('leave-room', {}, () => {
        console.log('Client: Leave Ack received');
        clearTimeout(timeout);
        socketRef.current?.disconnect();
        router.push('/');
      });
    } else {
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

  const handleTitleChange = (newTitle: string) => {
    socketRef.current?.emit('update-meeting-title', { roomId, title: newTitle });
  };

  const handleSendReaction = (emoji: string) => {
    socketRef.current?.emit('send-reaction', { roomId, emoji });
  };

  const resetControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  }, []);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [resetControlsTimer]);

  const ParticipantCard = ({
    participant,
    isLocal = false,
    isPinned = false,
    className = ""
  }: {
    participant: Participant | { userId: string, username: string, hasVideo: boolean, isMuted?: boolean, avatar_url?: string },
    isLocal?: boolean,
    isPinned?: boolean,
    className?: string
  }) => {
    return (
      <div className={cn("relative group bg-muted rounded-lg overflow-hidden border border-border shadow-sm transition-all", className)}>
        {/* Video / Avatar Area */}
        <div className="w-full h-full flex items-center justify-center bg-black/90">
          {isLocal ? (
            <video
              ref={el => {
                localVideoRef.current = el;
                if (el && localStream) {
                  el.srcObject = localStream;
                }
              }}
              autoPlay
              muted
              playsInline
              className={cn("w-full h-full object-contain", (localVideoOn && localStream) ? 'block' : 'hidden')}
            />
          ) : (
            <video
              ref={el => {
                if (participant.userId) {
                  remoteVideoRefs.current[participant.userId] = el;
                  if (el) {
                    const socketId = userIdToSocketIdMap.current[participant.userId];
                    if (socketId && !mediaSourcesRef.current[socketId]) {
                      setupMediaSource(participant.userId, socketId, 'video/webm; codecs=vp8,opus');
                    }
                  }
                }
              }}
              autoPlay
              playsInline
              className={cn("w-full h-full object-contain", participant.hasVideo ? 'block' : 'hidden')}
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
            {/* Temporary fix: We will update the ParticipantCard usage to pass isHostUser */}
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
                onClick={() => setPinnedUserId(isPinned ? null : participant.userId)}
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
      </div >
    );
  };



  // --- Render Logic ---

  const pinnedParticipant = participants.find(p => p.userId === pinnedUserId);
  const mainSpeaker = pinnedParticipant || participants[0]; // Default to first remote user if no pin
  const others = participants.filter(p => p.userId !== mainSpeaker?.userId);

  return (
    <div className="fixed inset-0 bg-background text-foreground overflow-hidden" >

      <div className="flex flex-1 overflow-hidden relative flex-col md:flex-row h-full">
        <ReactionOverlay reactions={reactions} />
        {/* Main Content Area */}
        <main
          className="flex-1 bg-neutral-900 relative p-4 pb-20 md:pb-4 flex items-center justify-center transition-all duration-300 overflow-hidden group min-h-0"
          onMouseMove={() => {
            // Only reset timer if controls are ALREADY visible.
            // Moving mouse should NOT show controls if they are hidden.
            if (showControls) {
              resetControlsTimer();
            }
          }}
          onClick={() => {
            // Unified toggle logic:
            // If visible -> Hide
            // If hidden -> Show (and start timer)
            if (showControls) {
              setShowControls(false);
              if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
            } else {
              setShowControls(true);
              resetControlsTimer();
            }
          }}
        >

          {/* Top Bar (View Switcher) - Moved inside Main */}
          <div className={
            cn(
              "absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-start transition-transform duration-300",
              showControls ? "translate-y-0" : "-translate-y-full"
            )
          }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-black/60 backdrop-blur-md p-2 rounded-lg text-white text-sm font-medium flex items-center gap-2">
              <span className="font-semibold px-2">{meetingTitle}</span>
              {isHost && (
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-white" onClick={() => setShowSettingsModal(true)}>
                  <Settings className="w-3 h-3" />
                </Button>
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
          </div>

          {layoutMode === 'speaker' ? (
            // Speaker View
            <div className="w-full h-full flex flex-col md:flex-row gap-4 pt-14 min-h-0">
              {/* Main Stage */}
              <div className="flex-1 relative rounded-xl overflow-hidden bg-black border border-white/10 shadow-2xl min-h-0">
                {mainSpeaker ? (
                  <ParticipantCard
                    participant={mainSpeaker}
                    isPinned={mainSpeaker.userId === pinnedUserId}
                    className="w-full h-full rounded-none border-0"
                  />
                ) : (
                  <ParticipantCard
                    participant={{ userId: 'local', username: session?.user?.name || 'Me', hasVideo: localVideoOn, isMuted: isMuted, avatar_url: session?.user?.image || undefined }}
                    isLocal={true}
                    className="w-full h-full rounded-none border-0"
                  />
                )}
              </div>
              {/* Filmstrip */}
              {(participants.length > 0) && (
                <div className="h-32 md:h-full md:w-48 lg:w-64 flex md:flex-col gap-2 overflow-x-auto md:overflow-y-auto scrollbar-hide min-h-0">
                  {mainSpeaker && (
                    <ParticipantCard
                      participant={{ userId: 'local', username: session?.user?.name || 'Me', hasVideo: localVideoOn, isMuted: isMuted, avatar_url: session?.user?.image || undefined }}
                      isLocal={true}
                      className="min-w-[160px] md:min-w-0 md:h-32 lg:h-40 aspect-video flex-shrink-0"
                    />
                  )}
                  {others.map(p => (
                    <ParticipantCard
                      key={p.userId}
                      participant={p}
                      isPinned={p.userId === pinnedUserId}
                      className="min-w-[160px] md:min-w-0 md:h-32 lg:h-40 aspect-video flex-shrink-0"
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Grid View
            <div className={cn(
              "w-full h-full grid gap-2 p-2 md:gap-4 md:p-4 pt-14 min-h-0",
              (participants.length + 1) <= 1 ? "grid-cols-1 grid-rows-1" :
                (participants.length + 1) <= 2 ? "grid-cols-1 md:grid-cols-2 grid-rows-2 md:grid-rows-1" :
                  (participants.length + 1) <= 4 ? "grid-cols-2 grid-rows-2" :
                    (participants.length + 1) <= 6 ? "grid-cols-2 md:grid-cols-3 grid-rows-3 md:grid-rows-2" :
                      (participants.length + 1) <= 9 ? "grid-cols-2 md:grid-cols-3 grid-rows-5 md:grid-rows-3" :
                        "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 auto-rows-fr"
            )}>
              <ParticipantCard
                participant={{ userId: 'local', username: session?.user?.name || 'Me', hasVideo: localVideoOn, isMuted: isMuted, avatar_url: session?.user?.image || undefined }}
                isLocal={true}
                className="min-h-0"
              />
              {participants.map(p => (
                <ParticipantCard
                  key={p.userId}
                  participant={p}
                  isPinned={p.userId === pinnedUserId}
                  className="min-h-0"
                />
              ))}
            </div>
          )}
          {/* Reaction Bar */}
          <div className={cn(
            "absolute bottom-24 left-1/2 transform -translate-x-1/2 z-30 transition-opacity duration-300",
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          )}>
            <ReactionBar onReaction={handleSendReaction} />
          </div>

          {/* Control Bar - Solid on Mobile, Floating Pill on Desktop */}
          <div className={cn(
            "fixed z-50 transition-all duration-300 ease-in-out flex items-center justify-center space-x-2 md:space-x-4 shadow-2xl",
            // Mobile Styles: Bottom fixed, full width, black background
            "bottom-0 left-0 right-0 h-16 bg-black border-t border-white/10 rounded-none px-4",
            // Desktop Styles: Floating pill, centered, rounded
            "md:bottom-8 md:left-1/2 md:transform md:-translate-x-1/2 md:h-auto md:bg-black/80 md:backdrop-blur-xl md:border md:rounded-full md:px-6 md:py-3 md:w-auto",
            showControls ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0 pointer-events-none"
          )}
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant={isMuted ? "destructive" : "secondary"}
              size="icon"
              className="rounded-full w-10 h-10 md:w-12 md:h-12"
              onClick={toggleMute}
            >
              {isMuted ? <MicOff className="w-4 h-4 md:w-5 md:h-5" /> : <Mic className="w-4 h-4 md:w-5 md:h-5" />}
            </Button>

            <Button
              variant={localVideoOn ? "secondary" : "destructive"}
              size="icon"
              className="rounded-full w-10 h-10 md:w-12 md:h-12"
              onClick={toggleCamera}
            >
              {localVideoOn ? <Video className="w-4 h-4 md:w-5 md:h-5" /> : <VideoOff className="w-4 h-4 md:w-5 md:h-5" />}
            </Button>

            <Button variant="secondary" size="icon" className="rounded-full w-10 h-10 md:w-12 md:h-12" onClick={() => setShowMorePanel(true)}>
              <Settings className="w-4 h-4 md:w-5 md:h-5" />
            </Button>

            <Button variant="secondary" size="icon" className="rounded-full w-10 h-10 md:w-12 md:h-12" onClick={() => setShowParticipantsPanel(true)}>
              <Users className="w-4 h-4 md:w-5 md:h-5" />
            </Button>

            <Button
              variant={showChatPanel ? "default" : "secondary"}
              size="icon"
              className="rounded-full w-10 h-10 md:w-12 md:h-12"
              onClick={() => setShowChatPanel(!showChatPanel)}
            >
              <MessageSquare className="w-4 h-4 md:w-5 md:h-5" />
            </Button>

            <div className="w-px h-6 md:h-8 bg-white/20 mx-1 md:mx-2" />

            <Button
              variant="destructive"
              className="rounded-full px-4 md:px-6 h-10 md:h-12 font-semibold bg-red-600 hover:bg-red-700 text-sm md:text-base"
              onClick={handleEndCallClick}
            >
              End
            </Button>
          </div>
        </main>

        {/* Chat Panel (Right Sidebar on Desktop, Full Overlay on Mobile) */}
        {showChatPanel && (
          <div className="fixed inset-0 z-50 md:static md:z-auto md:w-96 md:border-l bg-background h-full flex-shrink-0 transition-all duration-300">
            <ChatPanel
              messages={chatMessages}
              currentUserId={(session?.user as { id?: string }).id || session?.user?.email}
              newMessage={newMessage}
              onNewMessageChange={setNewMessage}
              onSendMessage={sendMessage}
              onClose={() => setShowChatPanel(false)}
            />
          </div>
        )}
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
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        currentTitle={meetingTitle}
        onTitleChange={handleTitleChange}
        isHost={isHost}
      />
    </div>
  );
}
