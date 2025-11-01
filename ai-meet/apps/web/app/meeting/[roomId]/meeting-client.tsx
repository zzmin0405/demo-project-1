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
  
  const socketRef = useRef<Socket | null>(null);
  const peerConnections = useRef<{ [userId: string]: RTCPeerConnection }>({});
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRefs = useRef<{ [userId: string]: HTMLVideoElement | null }>({});
  const socketIdToUserIdMap = useRef<{ [socketId: string]: string }>({});
  const isInitialized = useRef(false); // Flag to prevent double initialization in Strict Mode

  const [isLinkCopied, setIsLinkCopied] = useState(false);

  useEffect(() => {
    // This flag ensures initialize runs only once per logical mount, even with Strict Mode
    if (isInitialized.current) {
      console.log('Client: Already initialized (ref), skipping re-initialization.');
      return;
    }
    isInitialized.current = true; // Set flag to prevent further initialization

    let currentLocalStream: MediaStream | null = null;

    const createPeerConnection = (peerUserId: string, peerSocketId: string) => {
      try {
        const pc = new RTCPeerConnection(ICE_SERVERS);

        pc.onicecandidate = (event) => {
          if (event.candidate && socketRef.current) {
            socketRef.current.emit('ice-candidate', {
              to: peerSocketId,
              candidate: event.candidate,
            });
          }
        };

        pc.ontrack = (event) => {
          const videoElement = remoteVideoRefs.current[peerUserId];
          if (videoElement && event.streams[0]) {
            videoElement.srcObject = event.streams[0];
          }
        };

        currentLocalStream?.getTracks().forEach(track => {
          pc.addTrack(track, currentLocalStream!);
        });

        peerConnections.current[peerUserId] = pc;
        return pc;
      } catch (e) {
        console.error('Failed to create peer connection', e);
        return undefined;
      }
    };

    const initialize = async () => {
      // 1. Get User and Profile
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);
      const currentUserId = user.id; // Use this for filtering
      console.log('Client: currentUser set to', currentUserId, 'from supabase.auth.getUser()');

      const { data: profile } = await supabase.from('profiles').select('username, full_name, avatar_url').eq('id', user.id).single();
      const username = profile?.username || profile?.full_name || user.email || 'Anonymous';
      setUserProfile({ username, avatar_url: profile?.avatar_url });

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      // 2. Get Media
      try {
        currentLocalStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(currentLocalStream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = currentLocalStream;
        }
      } catch (err) {
        console.error('Error accessing media devices:', err);
        return;
      }

      // 3. Initialize WebSocket and Join Room
      const socket = io('http://localhost:3001', {
        auth: {
          token: session.access_token,
        },
      });
      socketRef.current = socket;

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
        const filteredParticipants = participantsWithData.filter(p => p.userId !== currentUserId); // Use currentUserId
        console.log('Client: room-state filtered participants', filteredParticipants);
        setParticipants(filteredParticipants);

        data.participants.forEach(p => {
          socketIdToUserIdMap.current[p.socketId] = p.userId;
        });
      });

      socket.on('user-joined', async (data: Participant & { socketId: string }) => {
        console.log(`Client: New user ${data.username} joined with socketId ${data.socketId}.`);
        const { data: profile } = await supabase.from('profiles').select('avatar_url').eq('id', data.userId).single();
        const newParticipant = { ...data, avatar_url: profile?.avatar_url };
        
        if (newParticipant.userId !== currentUserId) { // Use currentUserId
          console.log('Client: Adding new participant', newParticipant);
          setParticipants(prev => [...prev, newParticipant]);
        } else {
          console.log('Client: Not adding self as new participant', newParticipant);
        }

        socketIdToUserIdMap.current[data.socketId] = data.userId;

        const pc = createPeerConnection(data.userId, data.socketId);
        if (pc) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', { to: data.socketId, offer });
        }
      });

      socket.on('offer', async (data: { from: string; offer: any }) => {
        console.log('Client: Received offer from', data.from);
        const userId = socketIdToUserIdMap.current[data.from];
        if (!userId) {
          console.warn('Client: Could not find userId for socketId', data.from);
          return;
        }

        const pc = createPeerConnection(userId, data.from);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('answer', { to: data.from, answer });
        }
      });

      socket.on('answer', async (data: { from: string; answer: any }) => {
        console.log('Client: Received answer from', data.from);
        const userId = socketIdToUserIdMap.current[data.from];
        if (!userId) return;

        const pc = peerConnections.current[userId];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      });

      socket.on('ice-candidate', (data: { from: string; candidate: any }) => {
        console.log('Client: Received ICE candidate from', data.from);
        const userId = socketIdToUserIdMap.current[data.from];
        if (!userId) return;

        const pc = peerConnections.current[userId];
        if (pc) {
          pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      });

      socket.on('user-left', (data: { userId: string }) => {
        console.log(`Client: User ${data.userId} left`);
        if (peerConnections.current[data.userId]) {
          peerConnections.current[data.userId].close();
          delete peerConnections.current[data.userId];
        }
        for (const socketId in socketIdToUserIdMap.current) {
          if (socketIdToUserIdMap.current[socketId] === data.userId) {
            delete socketIdToUserIdMap.current[socketId];
            break;
          }
        }
        setParticipants(prev => prev.filter(p => p.userId !== data.userId));
      });

      socket.on('camera-state-changed', (data: { userId: string; hasVideo: boolean }) => {
        console.log(`Client: User ${data.userId} camera state changed: ${data.hasVideo}`);
        setParticipants(prev => prev.map(p => p.userId === data.userId ? { ...p, hasVideo: data.hasVideo } : p));
      });

      socket.on('disconnect', (reason) => {
        console.log('Client: Disconnected from WebSocket server', reason);
        setParticipants([]);
      });
      socket.on('connect_error', (error) => {
        console.error('Client: WebSocket connection error', error);
      });
    };

    initialize();

    return () => {
      currentLocalStream?.getTracks().forEach(track => track.stop());
      Object.values(peerConnections.current).forEach(pc => pc.close());
      socketRef.current?.disconnect();
      socketRef.current = null; // Reset socketRef.current
      socketIdToUserIdMap.current = {};
      // isInitialized.current is NOT reset here. It should persist across Strict Mode double-invocations.
    };
  }, [roomId, router, supabase]);

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

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setIsLinkCopied(true);
    setTimeout(() => {
      setIsLinkCopied(false);
    }, 2000);
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
            <Button variant="secondary" className="w-full">Mute</Button>
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