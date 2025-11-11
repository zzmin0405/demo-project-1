'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { createPagesBrowserClient } from '@supabase/auth-helpers-nextjs';
import Image from 'next/image';
import { Button } from "@/components/ui/button";
import type { User } from '@supabase/supabase-js';

interface Participant {
  userId: string;
  username: string;
  hasVideo: boolean;
  avatar_url?: string;
}

export default function MeetingClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createPagesBrowserClient());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<{ username: string, avatar_url?: string } | null>(null);
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
  
  const socketRef = useRef<Socket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const remoteVideoRefs = useRef<{ [userId: string]: HTMLVideoElement | null }>({});
  const socketIdToUserIdMap = useRef<{ [socketId: string]: string }>({});
  const userIdToSocketIdMap = useRef<{ [userId: string]: string }>({});
  const isInitialized = useRef(false);

  const mediaSourcesRef = useRef<{ [socketId: string]: MediaSource }>({});
  const sourceBuffersRef = useRef<{ [socketId: string]: SourceBuffer }>({});
  const chunkQueueRef = useRef<{ [socketId: string]: Blob[] }>({});

  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const [showEndCallModal, setShowEndCallModal] = useState(false);
  const [showMorePanel, setShowMorePanel] = useState(false);
  const [exitImmediately, setExitImmediately] = useState(false);


  useEffect(() => {
    const savedSetting = localStorage.getItem('exitImmediately') === 'true';
    setExitImmediately(savedSetting);
  }, []);

  useEffect(() => {
    if (isInitialized.current) {
      return;
    }
    isInitialized.current = true;

    const websocketUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'http://localhost:3001';
    console.log('Attempting to connect to WebSocket at:', websocketUrl); // DEBUGGING LINE
    const socket = io(websocketUrl, {
      autoConnect: false,
      extraHeaders: {
        'ngrok-skip-browser-warning': 'true'
      },
      auth: {},
    });
    socketRef.current = socket;

    const setupMediaSource = (userId: string, socketId: string) => {
      if (mediaSourcesRef.current[socketId] || !remoteVideoRefs.current[userId]) {
        return;
      }
      console.log(`Setting up MediaSource for userId: ${userId}, socketId: ${socketId}`);
      const mediaSource = new MediaSource();
      mediaSourcesRef.current[socketId] = mediaSource;
      const videoElement = remoteVideoRefs.current[userId];

      if (videoElement) {
        videoElement.src = URL.createObjectURL(mediaSource);
        videoElement.onloadedmetadata = () => videoElement.play().catch(e => console.error("Autoplay failed", e));
      }

      mediaSource.addEventListener('sourceopen', () => {
        console.log(`MediaSource opened for ${socketId}`);
        try {
          const mime = 'video/webm; codecs="vp8, opus"';
          if (!MediaSource.isTypeSupported(mime)) {
            console.error(`${mime} is not supported`);
            return;
          }
          const sourceBuffer = mediaSource.addSourceBuffer(mime);
          sourceBuffersRef.current[socketId] = sourceBuffer;

          sourceBuffer.addEventListener('updateend', async () => {
            if (chunkQueueRef.current[socketId]?.length > 0 && !sourceBuffer.updating) {
              const nextChunk = chunkQueueRef.current[socketId].shift();
              if (nextChunk) {
                try {
                  sourceBuffer.appendBuffer(await nextChunk.arrayBuffer());
                } catch (e) {
                  console.error(`Error appending queued buffer for ${socketId}`, e);
                }
              }
            }
          });
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

    const initialize = async () => {
      console.log('Client: Initializing...');
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('Client: No user found, redirecting to login.');
        router.push('/login');
        return;
      }
      const currentUserId = user.id;
      setCurrentUser(user);
      console.log('Client: currentUser set to', currentUserId);

      const { data: profile } = await supabase.from('profiles').select('username, full_name, avatar_url').eq('id', user.id).single();
      const username = profile?.username || profile?.full_name || user.email || 'Anonymous';
      setUserProfile({ username, avatar_url: profile?.avatar_url });

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log('Client: No session found, redirecting to login.');
        router.push('/login');
        return;
      }
      // @ts-expect-error Property 'auth' does not exist on type 'Socket'
      socket.auth.token = session.access_token;

      try {
        console.log('Client: Enumerating media devices...');
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
        socket.emit('join-room', { roomId, username });
      });

      socket.on('room-state', async (data: { participants: (Participant & { socketId: string })[] }) => {
        console.log('Client: room-state received', data.participants);
        const userIds = data.participants.map(p => p.userId);
        let participantsWithData = data.participants;

        if (userIds.length > 0) {
          const { data: profiles } = await supabase.from('profiles').select('id, avatar_url').in('id', userIds);
          participantsWithData = data.participants.map(p => ({
            ...p,
            avatar_url: profiles?.find(pr => pr.id === p.userId)?.avatar_url,
          }));
        }
        const filteredParticipants = participantsWithData.filter(p => p.userId !== currentUserId);
        setParticipants(filteredParticipants);

        // Use a timeout to ensure video elements are rendered before setting up MediaSource
        setTimeout(() => {
          data.participants.forEach(p => {
            if (p.userId !== currentUserId) {
              socketIdToUserIdMap.current[p.socketId] = p.userId;
              userIdToSocketIdMap.current[p.userId] = p.socketId;
              setupMediaSource(p.userId, p.socketId);
            }
          });
        }, 100);
      });

      socket.on('user-joined', async (data: Participant & { socketId: string }) => {
        console.log(`Client: New user ${data.username} joined with socketId ${data.socketId}.`);
        if (data.userId === currentUserId) return;

        const { data: profile } = await supabase.from('profiles').select('avatar_url').eq('id', data.userId).single();
        const newParticipant = { ...data, avatar_url: profile?.avatar_url };
        
        setParticipants(prev => {
          const newParticipants = [...prev, newParticipant];
          // Use a timeout to ensure video element is rendered before setting up MediaSource
          setTimeout(() => {
            socketIdToUserIdMap.current[data.socketId] = data.userId;
            userIdToSocketIdMap.current[data.userId] = data.socketId;
            setupMediaSource(data.userId, data.socketId);
          }, 100);
          return newParticipants;
        });
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

      socket.on('media-chunk', async (data: { socketId: string, chunk: ArrayBuffer }) => {
        const { socketId, chunk } = data;
        const blob = new Blob([chunk], { type: 'video/webm' });
        const sourceBuffer = sourceBuffersRef.current[socketId];

        if (sourceBuffer && !sourceBuffer.updating) {
            try {
                sourceBuffer.appendBuffer(await blob.arrayBuffer());
            } catch (e) {
                console.error(`Error appending buffer for ${socketId}`, e);
            }
        } else {
            if (!chunkQueueRef.current[socketId]) {
                chunkQueueRef.current[socketId] = [];
            }
            chunkQueueRef.current[socketId].push(blob);
        }
      });

      socket.on('camera-state-changed', (data: { userId: string; hasVideo: boolean }) => {
        setParticipants(prev => prev.map(p => p.userId === data.userId ? { ...p, hasVideo: data.hasVideo } : p));
      });

      socket.on('disconnect', (reason) => {
        console.log('Client: Disconnected from WebSocket server', reason);
      });
      socket.on('connect_error', (error) => {
        console.error('Client: WebSocket connection error', error);
      });
    };

    initialize();

    return () => {
      console.log('Client: useEffect cleanup');
      mediaRecorderRef.current?.stop();
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      
      Object.keys(mediaSourcesRef.current).forEach(socketId => {
        cleanupMediaSource(socketId);
      });

      socket.disconnect();
      socketRef.current = null;
      socketIdToUserIdMap.current = {};
      userIdToSocketIdMap.current = {};
      setParticipants([]);
    };
  }, [roomId, router, supabase]);


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

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const toggleCamera = async () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setLocalVideoOn(videoTrack.enabled);
        
        socketRef.current?.emit('camera-state-changed', {
          roomId,
          userId: currentUser?.id,
          hasVideo: videoTrack.enabled,
        });
      }
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setIsLinkCopied(true);
    setTimeout(() => {
      setIsLinkCopied(false);
    }, 2000);
  };

  const startCamera = async () => {
    try {
      console.log('Client: Manually starting camera...');
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputDevices = devices.filter(device => device.kind === 'videoinput');
      setAvailableVideoDevices(videoInputDevices);
      const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
      setAvailableAudioInputDevices(audioInputDevices);
      const audioOutputDevices = devices.filter(device => device.kind === 'audiooutput');
      setAvailableAudioOutputDevices(audioOutputDevices);

      const videoConstraint: boolean | MediaTrackConstraints = selectedVideoDeviceId
        ? { deviceId: { exact: selectedVideoDeviceId } }
        : true;

      const audioConstraint: boolean | MediaTrackConstraints = selectedAudioInputDeviceId
        ? { deviceId: { exact: selectedAudioInputDeviceId } }
        : true;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: audioConstraint
      });

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      setLocalStream(stream);
      localStreamRef.current = stream;
      setLocalVideoOn(true);
      console.log('Client: Media stream obtained manually.');

      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      if (socketRef.current && stream) {
        const options = { mimeType: 'video/webm; codecs=vp8,opus' };
        const mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0 && socketRef.current) {
            socketRef.current.emit('media-chunk', event.data);
          }
        };
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.start(1500); // 1.5초 timeslice로 변경하여 부하 감소
      }

      socketRef.current?.emit('camera-state-changed', { 
        roomId, 
        userId: currentUser?.id, 
        hasVideo: true 
      });
    } catch (err) {
      console.error('Error accessing media devices manually:', err);
    }
  };

  const leaveRoom = () => {
    console.log('Client: Leaving room');
    mediaRecorderRef.current?.stop();
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    socketRef.current?.disconnect();
    router.push('/');
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

  return (
    <>
      <div className="flex flex-col h-screen bg-background text-foreground">
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 p-2 md:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4 overflow-y-auto">
            {currentUser && (
              <div className="bg-muted aspect-video rounded-lg flex items-center justify-center border-2 border-primary relative">
                <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover rounded-lg" style={{ display: localVideoOn ? 'block' : 'none' }}></video>
                {!localVideoOn && (
                  userProfile?.avatar_url ?
                    <Image src={userProfile.avatar_url} alt={userProfile.username || 'User avatar'} width={96} height={96} className="rounded-full object-cover" /> :
                    <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center text-3xl font-bold">{userProfile?.username?.[0]}</div>
                )}
                <span className="absolute bottom-2 left-2 bg-black bg-opacity-75 px-2 py-1 rounded text-xs md:text-base text-white">You ({userProfile?.username})</span>
              </div>
            )}

            {participants.map(p => (
              <div key={p.userId} className="bg-muted aspect-video rounded-lg flex items-center justify-center relative">
                {p.hasVideo ? (
                  <video 
                    ref={el => { remoteVideoRefs.current[p.userId] = el; }}
                    autoPlay 
                    playsInline
                    className="w-full h-full object-cover rounded-lg"
                  ></video>
                ) : (
                  p.avatar_url ?
                    <Image src={p.avatar_url} alt={p.username || 'Participant avatar'} width={96} height={96} className="rounded-full object-cover" /> :
                    <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center text-3xl font-bold">{p.username?.[0]}</div>
                )}
                <span className="absolute bottom-2 left-2 bg-black bg-opacity-75 px-2 py-1 rounded text-xs md:text-base text-white">{p.username}</span>
              </div>
            ))}
          </main>

          <div className="hidden md:flex flex-col w-64 bg-card border-l p-4 space-y-4">
            <h3 className="text-lg font-semibold text-center">Controls</h3>
            
            <div className="space-y-2">
              {availableVideoDevices.length > 0 && (
                  <select
                    className="w-full p-2 border rounded-md bg-secondary text-secondary-foreground text-sm"
                    value={selectedVideoDeviceId || ''}
                    onChange={(e) => setSelectedVideoDeviceId(e.target.value)}
                  >
                    {availableVideoDevices.map(device => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${device.deviceId}`}</option>
                    ))}
                  </select>
              )}
              {availableAudioInputDevices.length > 0 && (
                  <select
                    className="w-full p-2 border rounded-md bg-secondary text-secondary-foreground text-sm"
                    value={selectedAudioInputDeviceId || ''}
                    onChange={(e) => setSelectedAudioInputDeviceId(e.target.value)}
                  >
                    {availableAudioInputDevices.map(device => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${device.deviceId}`}</option>
                    ))}
                  </select>
              )}
              {availableAudioOutputDevices.length > 0 && (
                <select
                  className="w-full p-2 border rounded-md bg-secondary text-secondary-foreground text-sm"
                  value={selectedAudioOutputDeviceId || ''}
                  onChange={(e) => setSelectedAudioOutputDeviceId(e.target.value)}
                >
                  {availableAudioOutputDevices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>{device.label || `Speaker ${device.deviceId}`}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="w-full flex items-center space-x-2 pt-2">
              <span title="Master Volume">🔊</span>
              <input
                type="range" min="0" max="1" step="0.05" value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full h-2 bg-muted-foreground rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div className="space-y-2">
              <Button variant="secondary" className="w-full" onClick={toggleMute}>{isMuted ? 'Unmute' : 'Mute'}</Button>
              {localStream ? (
                <Button variant="secondary" className="w-full" onClick={toggleCamera}>{localVideoOn ? 'Stop Video' : 'Start Video'}</Button>
              ) : (
                <Button variant="secondary" className="w-full" onClick={startCamera}>Start Camera</Button>
              )}
              <Button variant="secondary" className="w-full">Share Screen</Button>
              <Button variant="secondary" className="w-full" onClick={copyLink}>{isLinkCopied ? 'Copied!' : 'Copy Link'}</Button>
              <Button variant="destructive" className="w-full" onClick={handleEndCallClick}>End Call</Button>
            </div>
          </div>
        </div>

        <div className="md:hidden bg-card border-t p-2 flex items-center justify-around">
          <Button variant="ghost" size="icon" onClick={toggleMute} className="flex flex-col h-auto">
            <span className="text-2xl">{isMuted ? '🔇' : '🎤'}</span>
            <span className="text-xs">{isMuted ? 'Unmute' : 'Mute'}</span>
          </Button>
          {localStream ? (
            <Button variant="ghost" size="icon" onClick={toggleCamera} className="flex flex-col h-auto">
              <span className="text-2xl">{localVideoOn ? '📹' : '📸'}</span>
              <span className="text-xs">{localVideoOn ? 'Stop' : 'Start'}</span>
            </Button>
          ) : (
            <Button variant="ghost" size="icon" onClick={startCamera} className="flex flex-col h-auto">
              <span className="text-2xl">📷</span>
              <span className="text-xs">Start Cam</span>
            </Button>
          )}
          <Button variant="ghost" size="icon" className="flex flex-col h-auto">
            <span className="text-2xl">🖥️</span>
            <span className="text-xs">Share</span>
          </Button>
          <Button variant="destructive" size="icon" onClick={handleEndCallClick} className="flex flex-col h-auto bg-red-600 hover:bg-red-700">
            <span className="text-2xl">📞</span>
            <span className="text-xs">End</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowMorePanel(true)} className="flex flex-col h-auto">
            <span className="text-2xl">...</span>
            <span className="text-xs">More</span>
          </Button>
        </div>
      </div>

      {showMorePanel && (
        <div className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-40" onClick={() => setShowMorePanel(false)}>
          <div className="fixed bottom-0 left-0 right-0 bg-card border-t rounded-t-lg p-4 z-50 animate-in slide-in-from-bottom-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 text-center">More Options</h3>
            <div className="space-y-4">
              <Button variant="secondary" className="w-full" onClick={copyLink}>
                {isLinkCopied ? 'Copied!' : 'Copy Link'}
              </Button>
              
              {availableVideoDevices.length > 0 && (
                <select
                  className="w-full p-2 border rounded-md bg-secondary text-secondary-foreground text-sm"
                  value={selectedVideoDeviceId || ''}
                  onChange={(e) => setSelectedVideoDeviceId(e.target.value)}
                >
                  {availableVideoDevices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${device.deviceId}`}</option>
                  ))}
                </select>
              )}
              {availableAudioInputDevices.length > 0 && (
                <select
                  className="w-full p-2 border rounded-md bg-secondary text-secondary-foreground text-sm"
                  value={selectedAudioInputDeviceId || ''}
                  onChange={(e) => setSelectedAudioInputDeviceId(e.target.value)}
                >
                  {availableAudioInputDevices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${device.deviceId}`}</option>
                  ))}
                </select>
              )}
              {availableAudioOutputDevices.length > 0 && (
                <select
                  className="w-full p-2 border rounded-md bg-secondary text-secondary-foreground text-sm"
                  value={selectedAudioOutputDeviceId || ''}
                  onChange={(e) => setSelectedAudioOutputDeviceId(e.target.value)}
                >
                  {availableAudioOutputDevices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>{device.label || `Speaker ${device.deviceId}`}</option>
                  ))}
                </select>
              )}

              <div className="w-full flex items-center space-x-2 pt-2">
                <span title="Master Volume">🔊</span>
                <input
                  type="range" min="0" max="1" step="0.05" value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-full h-2 bg-muted-foreground rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-2 bg-muted rounded-lg">
                <label htmlFor="exit-immediately-toggle">Exit Immediately</label>
                <input
                  type="checkbox"
                  id="exit-immediately-toggle"
                  className="w-5 h-5"
                  checked={exitImmediately}
                  onChange={handleExitImmediatelyChange}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {showEndCallModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-lg shadow-xl max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Leave Meeting?</h3>
            <p className="text-muted-foreground mb-6">Are you sure you want to leave this meeting?</p>
            <div className="flex justify-end space-x-4">
              <Button variant="ghost" onClick={() => setShowEndCallModal(false)}>Cancel</Button>
              <Button variant="destructive" onClick={leaveRoom}>Leave</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}