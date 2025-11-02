'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { createPagesBrowserClient } from '@supabase/auth-helpers-nextjs';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { User } from '@supabase/supabase-js';

interface Participant {
  userId: string;
  username: string;
  hasVideo: boolean;
  avatar_url?: string;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export default function MeetingClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createPagesBrowserClient());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<{ username: string, avatar_url?: string } | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localVideoOn, setLocalVideoOn] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string | null>(null);
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [availableAudioInputDevices, setAvailableAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState<string | null>(null);
  const [availableAudioOutputDevices, setAvailableAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.8); // Master volume for remote streams
  
  const socketRef = useRef<Socket | null>(null);
  const peerConnections = useRef<{ [userId: string]: RTCPeerConnection }>({});
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRefs = useRef<{ [userId: string]: HTMLVideoElement | null }>({});
  const socketIdToUserIdMap = useRef<{ [socketId: string]: string }>({});
  const userIdToSocketIdMap = useRef<{ [userId: string]: string }>({});
  const isInitialized = useRef(false); // Flag to prevent double initialization in Strict Mode

  const [isLinkCopied, setIsLinkCopied] = useState(false);

  useEffect(() => {
    if (isInitialized.current) {
      return;
    }
    isInitialized.current = true;

    console.log('Client: useEffect triggered');
    let localStreamForCleanup: MediaStream | null = null;
    const socket = io(process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'http://localhost:3001', {
      autoConnect: false, // Prevent auto-connection
      auth: {
        // This will be populated after we get the session
      },
    });
    socketRef.current = socket;

    const createPeerConnection = (peerUserId: string, peerSocketId: string) => {
      console.log(`Client: Creating peer connection for ${peerUserId}`);
      try {
        const pc = new RTCPeerConnection(ICE_SERVERS);

        pc.onicecandidate = (event) => {
          if (event.candidate && socketRef.current) {
            console.log(`Client: Sending ICE candidate to ${peerUserId}`);
            socketRef.current.emit('ice-candidate', {
              to: peerSocketId,
              candidate: event.candidate,
            });
          }
        };

        pc.ontrack = (event) => {
          console.log(`Client: Received track from ${peerUserId}`);
          const videoElement = remoteVideoRefs.current[peerUserId];
          if (videoElement && event.streams[0]) {
            videoElement.srcObject = event.streams[0];
          }
        };

        // If the local stream already exists, add its tracks to the peer connection.
        if (localStreamRef.current) {
          console.log(`Client: Adding local stream tracks to new peer connection for ${peerUserId}`);
          localStreamRef.current.getTracks().forEach(track => {
            pc.addTrack(track, localStreamRef.current!);
          });
        }

        peerConnections.current[peerUserId] = pc;
        return pc;
      } catch (e) {
        console.error('Failed to create peer connection', e);
        return undefined;
      }
    };

    const initialize = async () => {
      console.log('Client: Initializing...');
      // 1. Get User and Profile
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('Client: No user found, redirecting to login.');
        router.push('/login');
        return;
      }
      setCurrentUser(user);
      const currentUserId = user.id;
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
      // @ts-ignore
      socket.auth.token = session.access_token;

      // 2. Get Media
      console.log('Client: Media will be acquired manually.');

      // 3. Initialize WebSocket and Join Room
      socket.connect();

      socket.on('connect', () => {
        console.log('Client: Connected to WebSocket server with socketId:', socket.id);
        socket.emit('join-room', { roomId, username });
      });

      // 4. Handle Signaling
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

        data.participants.forEach(p => {
          socketIdToUserIdMap.current[p.socketId] = p.userId;
          userIdToSocketIdMap.current[p.userId] = p.socketId;
        });
      });

      socket.on('user-joined', async (data: Participant & { socketId: string }) => {
        console.log(`Client: New user ${data.username} joined with socketId ${data.socketId}.`);
        if (data.userId === currentUserId) return; // Don't process self-join

        const { data: profile } = await supabase.from('profiles').select('avatar_url').eq('id', data.userId).single();
        const newParticipant = { ...data, avatar_url: profile?.avatar_url };
        setParticipants(prev => [...prev, newParticipant]);
        socketIdToUserIdMap.current[data.socketId] = data.userId;
        userIdToSocketIdMap.current[data.userId] = data.socketId;

        const pc = createPeerConnection(data.userId, data.socketId);
        if (pc) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          console.log(`Client: Sending offer to ${data.username}`);
          socket.emit('offer', { to: data.socketId, offer });
        }
      });

      socket.on('offer', async (data: { from: string; offer: any }) => {
        const userId = socketIdToUserIdMap.current[data.from];
        console.log(`Client: Received offer from ${userId}`);
        if (!userId) return;

        const pc = createPeerConnection(userId, data.from);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log(`Client: Sending answer to ${userId}`);
          socket.emit('answer', { to: data.from, answer });
        }
      });

      socket.on('answer', async (data: { from: string; answer: any }) => {
        const userId = socketIdToUserIdMap.current[data.from];
        console.log(`Client: Received answer from ${userId}`);
        if (!userId) return;

        const pc = peerConnections.current[userId];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      });

      socket.on('ice-candidate', (data: { from: string; candidate: any }) => {
        const userId = socketIdToUserIdMap.current[data.from];
        if (!userId) return;
        const pc = peerConnections.current[userId];
        if (pc) {
          console.log(`Client: Adding ICE candidate from ${userId}`);
          pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      });

      socket.on('user-left', (data: { userId: string }) => {
        console.log(`Client: User ${data.userId} left`);
        if (peerConnections.current[data.userId]) {
          peerConnections.current[data.userId].close();
          delete peerConnections.current[data.userId];
        }
        // Clean up maps
        const socketId = Object.keys(socketIdToUserIdMap.current).find(sid => socketIdToUserIdMap.current[sid] === data.userId);
        if (socketId) {
          delete socketIdToUserIdMap.current[socketId];
        }
        delete userIdToSocketIdMap.current[data.userId];
        setParticipants(prev => prev.filter(p => p.userId !== data.userId));
      });

      socket.on('camera-state-changed', (data: { userId: string; hasVideo: boolean }) => {
        console.log(`Client: User ${data.userId} camera state changed: ${data.hasVideo}`);
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
      localStreamForCleanup?.getTracks().forEach(track => track.stop());
      Object.values(peerConnections.current).forEach(pc => pc.close());
      peerConnections.current = {};
      socket.disconnect();
      socketRef.current = null;
      socketIdToUserIdMap.current = {};
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

  const toggleCamera = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setLocalVideoOn(videoTrack.enabled);
        socketRef.current?.emit('camera-state-changed', { roomId, userId: currentUser?.id, hasVideo: videoTrack.enabled });
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

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: audioConstraint
      });

      setLocalStream(stream);
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      console.log('Client: Media stream obtained manually.');

      // Add/replace tracks and renegotiate if needed
      for (const peerUserId in peerConnections.current) {
        const pc = peerConnections.current[peerUserId];
        let negotiationNeeded = false;

        stream.getTracks().forEach(track => {
          const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track);
          } else {
            pc.addTrack(track, stream);
            negotiationNeeded = true;
          }
        });

        if (negotiationNeeded) {
          const socketId = userIdToSocketIdMap.current[peerUserId];
          if (socketId) {
            console.log(`Client: Renegotiating with ${peerUserId}`);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socketRef.current?.emit('offer', { to: socketId, offer });
          }
        }
      }
    } catch (err) {
      console.error('Error accessing media devices manually:', err);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto">
          {currentUser && (
            <div className="bg-muted aspect-video rounded-lg flex items-center justify-center border-2 border-primary relative">
              {localVideoOn ? (
                <video ref={localVideoRef} autoPlay muted className="w-full h-full object-cover rounded-lg"></video>
              ) : (
                userProfile?.avatar_url ? 
                  <img src={userProfile.avatar_url} alt={userProfile.username} className="w-24 h-24 rounded-full" /> : 
                  <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center text-3xl font-bold">{userProfile?.username?.[0]}</div>
              )}
              <span className="absolute bottom-2 left-2 bg-black bg-opacity-75 px-2 py-1 rounded text-base text-white">You ({userProfile?.username})</span>
            </div>
          )}

          {participants.map(p => (
            <div key={p.userId} className="bg-muted aspect-video rounded-lg flex items-center justify-center relative">
              {p.hasVideo ? (
                <video ref={el => remoteVideoRefs.current[p.userId] = el} autoPlay className="w-full h-full object-cover rounded-lg"></video>
              ) : (
                p.avatar_url ? 
                  <img src={p.avatar_url} alt={p.username} className="w-24 h-24 rounded-full" /> : 
                  <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center text-3xl font-bold">{p.username?.[0]}</div>
              )}
              <span className="absolute bottom-2 left-2 bg-black bg-opacity-75 px-2 py-1 rounded text-base text-white">{p.username}</span>
            </div>
          ))}
        </main>

        <aside className="w-80 bg-card p-4 flex flex-col border-l">
          <h2 className="text-lg font-semibold mb-4">Chat</h2>
          <div className="flex-1 bg-muted rounded-lg p-2 mb-4 overflow-y-auto">
            <p className="text-sm text-muted-foreground mb-2">[2:30 PM] Alice: Hello everyone!</p>
            <p className="text-sm text-muted-foreground mb-2">[2:31 PM] Bob: Hey Alice, how are you?</p>
          </div>
          <div className="flex">
            <Input type="text" placeholder="Type a message..." className="flex-1" />
            <Button>Send</Button>
          </div>
        </aside>

        <div className="w-40 bg-background p-4 flex flex-col items-center justify-center space-y-4 border-l">
            {availableVideoDevices.length > 0 && (
              <select
                className="w-full p-2 border rounded-md bg-secondary text-secondary-foreground"
                value={selectedVideoDeviceId || ''}
                onChange={(e) => {
                  setSelectedVideoDeviceId(e.target.value);
                }}
              >
                {availableVideoDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${device.deviceId}`}
                  </option>
                ))}
              </select>
            )}
            {availableAudioInputDevices.length > 0 && (
              <select
                className="w-full p-2 border rounded-md bg-secondary text-secondary-foreground"
                value={selectedAudioInputDeviceId || ''}
                onChange={(e) => {
                  setSelectedAudioInputDeviceId(e.target.value);
                }}
              >
                {availableAudioInputDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${device.deviceId}`}
                  </option>
                ))}
              </select>
            )}
            {availableAudioOutputDevices.length > 0 && (
              <select
                className="w-full p-2 border rounded-md bg-secondary text-secondary-foreground"
                value={selectedAudioOutputDeviceId || ''}
                onChange={(e) => {
                  setSelectedAudioOutputDeviceId(e.target.value);
                }}
              >
                {availableAudioOutputDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Speaker ${device.deviceId}`}
                  </option>
                ))}
              </select>
            )}
                        <div className="w-full flex items-center space-x-2 pt-2">
              <span title="Master Volume">🔊</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full h-2 bg-muted-foreground rounded-lg appearance-none cursor-pointer"
              />
            </div>
            <Button variant="secondary" className="w-full" onClick={toggleMute}>{isMuted ? 'Unmute' : 'Mute'}</Button>
            <Button variant="secondary" className="w-full" onClick={startCamera}>Start Camera</Button>
            <Button variant="secondary" className="w-full" onClick={toggleCamera}>
              {localVideoOn ? 'Stop Video' : 'Start Video'}
            </Button>
            <Button variant="secondary" className="w-full">Share Screen</Button>
            <Button variant="secondary" className="w-full" onClick={copyLink}>
              {isLinkCopied ? 'Copied!' : 'Copy Link'}
            </Button>
            <Button variant="destructive" className="w-full">End Call</Button>
        </div>
      </div>
    </div>
  );
}