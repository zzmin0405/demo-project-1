import { UseGuards } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

interface Participant {
  userId: string;
  username: string;
  hasVideo: boolean;
  isMuted: boolean;
  avatar_url?: string;
}

@UseGuards(SupabaseAuthGuard)
@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ["GET", "POST"],
    allowedHeaders: ['authorization', 'content-type'],
    credentials: false,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(private prisma: PrismaService) { }

  @WebSocketServer()
  server: Server;

  private roomToUsers = new Map<string, Map<string, Participant>>(); // roomId -> Map<socketId, Participant>
  private userIdToRoom = new Map<string, string>(); // userId -> roomId

  handleConnection(client: Socket, ...args: any[]) {
    const token = client.handshake.auth.token;
    const userId = client['user']?.sub || token; // Fallback if guard hasn't run yet (it should have)
    console.log(`[ConnectionDebug] Client connected: ${client.id}, Token/UserId: ${userId}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    this.leaveRoom(client);
  }

  @SubscribeMessage('media-chunk')
  handleMediaChunk(client: Socket, payload: { chunk: any, mimeType?: string } | any): void {
    const roomId = Array.from(client.rooms).find(r => r !== client.id);
    const userId = client['user']?.sub;

    // console.log(`[MediaChunkDebug] Received from ${client.id} (User: ${userId}) for Room ${roomId}`);

    if (roomId) {
      const chunk = payload.chunk || payload;
      const mimeType = payload.mimeType || 'video/webm; codecs="vp8, opus"';

      client.to(roomId).emit('media-chunk', {
        socketId: client.id,
        userId: userId, // Explicitly send userId to prevent mapping errors
        chunk: chunk,
        mimeType: mimeType
      });
    }
  }
  async handleChatMessage(client: Socket, data: { roomId: string; message: string }): Promise<void> {
    console.log(`[ChatDebug] Received message from ${client.id} for room ${data.roomId}: ${data.message}`);
    const userId = client['user']?.sub;
    if (!userId) {
      console.error(`[ChatDebug] No userId for client ${client.id}`);
      return;
    }

    const room = this.roomToUsers.get(data.roomId);
    if (!room) {
      const availableRooms = Array.from(this.roomToUsers.keys()).join(', ');
      console.error(`[ChatDebug] Room ${data.roomId} not found. Available rooms: ${availableRooms}`);
      client.emit('chat-error', { message: `Room not found. Available: ${availableRooms}` });
      return;
    }

    const participant = room.get(client.id);
    if (!participant) {
      console.error(`[ChatDebug] Participant not found for client ${client.id} in room ${data.roomId}`);
      client.emit('chat-error', { message: 'Participant not found in room' });
      return;
    }

    // 1. Save to Database (Async, don't block broadcast)
    try {
      const meetingRoom = await this.prisma.meetingRoom.findUnique({
        where: { id: data.roomId },
        select: { isChatSaved: true }
      });

      if (meetingRoom?.isChatSaved) {
        this.prisma.chatLog.create({
          data: {
            content: data.message,
            userId: userId,
            meetingRoomId: data.roomId,
          }
        }).catch(err => {
          console.error('Failed to save chat log:', err);
        });
      }
    } catch (error) {
      console.error('Error checking meeting settings:', error);
    }

    // 2. Broadcast to room
    this.server.to(data.roomId).emit('chat-message', {
      userId: userId,
      username: participant.username,
      message: data.message,
      timestamp: new Date().toISOString(),
      avatar_url: participant.avatar_url
    });
  }



  private leaveRoom(client: Socket, silent: boolean = false) {
    for (const [roomId, users] of this.roomToUsers.entries()) {
      if (users.has(client.id)) {
        const leavingUser = users.get(client.id)!;
        users.delete(client.id);

        // Check if the user still has other active sockets in this room (e.g., from a quick refresh)
        let userStillInRoom = false;
        for (const participant of users.values()) {
          if (participant.userId === leavingUser.userId) {
            userStillInRoom = true;
            break;
          }
        }

        if (users.size === 0) {
          this.roomToUsers.delete(roomId);
          console.log(`[RoomDebug] Room ${roomId} deleted (empty).`);
        }

        // Only cleanup global state and notify others if the user is TRULY gone
        if (!userStillInRoom) {
          // Remove from userIdToRoom map
          if (this.userIdToRoom.get(leavingUser.userId) === roomId) {
            this.userIdToRoom.delete(leavingUser.userId);
          }

          if (!silent) {
            this.server.to(roomId).emit('user-left', { userId: leavingUser.userId });
            console.log(`Client ${leavingUser.userId} left room ${roomId}`);
          } else {
            console.log(`Client ${leavingUser.userId} left room ${roomId} (Silent/Auto-Kick)`);
          }

          // DB Sync: Update leftAt
          this.prisma.participant.updateMany({
            where: {
              userId: leavingUser.userId,
              meetingRoomId: roomId,
              leftAt: null
            },
            data: {
              leftAt: new Date()
            }
          }).catch(err => console.error('Failed to update participant leftAt:', err));

        } else {
          console.log(`Client ${leavingUser.userId} socket ${client.id} disconnected, but user remains in room (refresh/ghost).`);
        }
        return;
      }
    }
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(client: Socket, data: { roomId: string; username: string; avatar_url?: string; hasVideo?: boolean; isMuted?: boolean }): Promise<void> {
    if (!client['user']?.sub) {
      console.error('Unauthorized join-room attempt: userId not found on socket.', {
        socketId: client.id,
      });
      client.emit('error', { message: 'Authentication error. Please reconnect.' });
      return;
    }

    const { roomId, username, avatar_url, hasVideo = false, isMuted = true } = data; // Default to false/true if not provided
    const userId = client['user'].sub; // Use the trusted userId from the guard

    // Single Meeting Enforcement with Auto-Kick
    // Single Meeting Enforcement with Auto-Kick
    const existingRoomId = this.userIdToRoom.get(userId);
    if (existingRoomId) {
      console.log(`User ${userId} is already in room ${existingRoomId}. Checking for stale sockets...`);

      const existingRoom = this.roomToUsers.get(existingRoomId);
      if (existingRoom) {
        for (const [oldSocketId, participant] of existingRoom.entries()) {
          if (participant.userId === userId) {
            // If it's the SAME socket, ignore (re-join)
            if (oldSocketId === client.id) continue;

            console.log(`[Auto-Kick] Found stale socket ${oldSocketId} for user ${userId} in room ${existingRoomId}. Disconnecting.`);

            const oldSocket = this.server.sockets.sockets.get(oldSocketId);
            if (oldSocket) {
              this.leaveRoom(oldSocket, true); // Silent leave to prevent user-left race condition
              oldSocket.emit('error', { message: '새로운 접속이 감지되어 연결이 종료되었습니다.' });
              oldSocket.disconnect(true);
            } else {
              // Manually cleanup if socket object is gone
              existingRoom.delete(oldSocketId);
              if (existingRoom.size === 0) this.roomToUsers.delete(existingRoomId);
              // Don't delete userIdToRoom yet if we are staying in the same room
            }
          }
        }
      }

      // If switching rooms, update mapping
      if (existingRoomId !== roomId) {
        this.userIdToRoom.delete(userId);
      }
    }

    console.log(`Authenticated client ${client.id} (userId: ${userId}) attempting to join room ${roomId}`);

    if (!this.roomToUsers.has(roomId)) {
      // Check if room exists in DB
      const meetingRoom = await this.prisma.meetingRoom.findUnique({
        where: { id: roomId }
      });

      if (!meetingRoom) {
        console.warn(`User ${userId} attempted to join non-existent room ${roomId}`);
        client.emit('error', { message: '존재하지 않는 회의입니다. 회의 ID를 확인해주세요.' });
        return;
      }

      this.roomToUsers.set(roomId, new Map<string, Participant>());
      console.log(`[RoomDebug] Room ${roomId} loaded from DB.`);
    }
    const room = this.roomToUsers.get(roomId)!;

    // Get other users' data including their socketId
    const otherUsers = Array.from(room.entries()).map(([socketId, participant]) => ({
      ...participant,
      socketId,
    }));

    // Add the new user
    room.set(client.id, { userId, username, hasVideo, isMuted, avatar_url });
    this.userIdToRoom.set(userId, roomId); // Track user's room
    client.join(roomId);

    // 1. Send the list of other participants (with socketIds) back to the new user.
    // Also send meeting metadata (title, hostId)
    const roomInfo = await this.prisma.meetingRoom.findUnique({
      where: { id: roomId },
      select: { title: true, creatorId: true }
    });

    // DB Sync: Upsert Participant record
    try {
      // First check if user exists to avoid P2003
      const userExists = await this.prisma.user.findUnique({ where: { id: userId } });
      if (userExists) {
        await this.prisma.participant.upsert({
          where: {
            userId_meetingRoomId: {
              userId: userId,
              meetingRoomId: roomId
            }
          },
          update: {
            joinedAt: new Date(),
            leftAt: null,
            status: 'APPROVED',
            role: roomInfo?.creatorId === userId ? 'HOST' : 'PARTICIPANT'
          },
          create: {
            userId: userId,
            meetingRoomId: roomId,
            status: 'APPROVED',
            role: roomInfo?.creatorId === userId ? 'HOST' : 'PARTICIPANT'
          }
        });
      } else {
        console.warn(`[ParticipantSync] User ${userId} not found in DB. Skipping participant record creation.`);
      }
    } catch (dbError) {
      console.error('Failed to sync participant to DB:', dbError);
    }

    client.emit('room-state', {
      roomId,
      participants: otherUsers,
      title: roomInfo?.title || 'Untitled Meeting',
      hostId: roomInfo?.creatorId
    });

    // 2. Notify everyone else that a new user has joined (with their socketId).
    client.to(roomId).emit('user-joined', { userId, username, hasVideo, isMuted, avatar_url, socketId: client.id });

    console.log(`Client ${userId} (${username}) joined room ${roomId}.`);
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(client: Socket, data: any, callback?: () => void): void {
    this.leaveRoom(client);
    if (callback && typeof callback === 'function') {
      callback();
    }
  }



  public async leaveRoomByUserId(roomId: string, userId: string) {
    console.log(`[LeaveByUserId] Force leaving user ${userId} from room ${roomId}`);

    const roomUsers = this.roomToUsers.get(roomId);
    if (!roomUsers) return;

    // Find socketId for this user
    let socketIdToRemove: string | null = null;
    for (const [socketId, participant] of roomUsers.entries()) {
      if (participant.userId === userId) {
        socketIdToRemove = socketId;
        break;
      }
    }

    if (socketIdToRemove) {
      const socket = this.server.sockets.sockets.get(socketIdToRemove);
      if (socket) {
        this.leaveRoom(socket);
      } else {
        // Socket not found (already disconnected?), manually cleanup
        const participant = roomUsers.get(socketIdToRemove);
        if (participant) {
          roomUsers.delete(socketIdToRemove);
          this.userIdToRoom.delete(userId);

          // Notify others
          this.server.to(roomId).emit('user-left', { userId });

          // DB Update
          await this.prisma.participant.updateMany({
            where: { userId, meetingRoomId: roomId, leftAt: null },
            data: { leftAt: new Date() }
          });
        }
      }
    }
  }



  // WebRTC Signaling Handlers
  @SubscribeMessage('offer')
  handleOffer(client: Socket, data: { to: string; offer: any }): void {
    const fromUserId = client['user'].sub; // Get userId from the authenticated socket
    client.to(data.to).emit('offer', {
      from: client.id,
      fromUserId: fromUserId, // Add this
      offer: data.offer
    });
  }

  @SubscribeMessage('answer')
  handleAnswer(client: Socket, data: { to: string; answer: any }): void {
    client.to(data.to).emit('answer', { from: client.id, answer: data.answer });
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(client: Socket, data: { to: string; candidate: any }): void {
    client.to(data.to).emit('ice-candidate', { from: client.id, candidate: data.candidate });
  }

  @SubscribeMessage('camera-state-changed')
  handleCameraStateChanged(client: Socket, data: { roomId: string; userId: string; hasVideo: boolean }): void {
    // Broadcast the camera state change to other users in the room
    client.to(data.roomId).emit('camera-state-changed', {
      userId: data.userId,
      hasVideo: data.hasVideo,
    });
  }

  @SubscribeMessage('mic-state-changed')
  handleMicStateChanged(client: Socket, data: { roomId: string; userId: string; isMuted: boolean }): void {
    // Update server state
    const room = this.roomToUsers.get(data.roomId);
    if (room && room.has(client.id)) {
      const participant = room.get(client.id);
      if (participant) {
        participant.isMuted = data.isMuted;
      }
    }

    // Broadcast the mic state change to other users in the room
    client.to(data.roomId).emit('mic-state-changed', {
      userId: data.userId,
      isMuted: data.isMuted,
    });
  }

  @SubscribeMessage('update-meeting-title')
  async handleUpdateMeetingTitle(client: Socket, data: { roomId: string; title: string }): Promise<void> {
    const userId = client['user']?.sub;
    if (!userId) return;

    try {
      // 1. Verify ownership (Host check)
      const room = await this.prisma.meetingRoom.findUnique({
        where: { id: data.roomId },
        select: { creatorId: true }
      });

      if (!room || room.creatorId !== userId) {
        client.emit('error', { message: 'Only the host can edit the meeting title.' });
        return;
      }

      // 2. Update DB
      await this.prisma.meetingRoom.update({
        where: { id: data.roomId },
        data: { title: data.title }
      });

      // 3. Broadcast to ALL users in the room (including sender)
      this.server.to(data.roomId).emit('meeting-title-updated', {
        title: data.title
      });

      console.log(`Meeting ${data.roomId} title updated to "${data.title}" by ${userId}`);

    } catch (error) {
      console.error('Error updating meeting title:', error);
      client.emit('error', { message: 'Failed to update meeting title.' });
    }
  }

  @SubscribeMessage('send-reaction')
  handleSendReaction(client: Socket, data: { roomId: string; emoji: string }): void {
    const userId = client['user']?.sub;
    if (!userId) return;

    // Broadcast reaction to all users in the room
    this.server.to(data.roomId).emit('reaction-received', {
      userId: userId,
      emoji: data.emoji
    });
  }

  // Force delete room (called by Controller)
  async forceDeleteRoom(roomId: string) {
    console.log(`[EventsGateway] Force deleting room ${roomId}`);

    // 1. Notify all users in the room
    this.server.to(roomId).emit('error', { message: 'The host has ended the meeting.' });
    this.server.to(roomId).emit('room-ended'); // Optional: specific event for clean exit

    // 2. Disconnect all sockets in the room
    const sockets = await this.server.in(roomId).fetchSockets();
    for (const socket of sockets) {
      socket.leave(roomId);
      socket.disconnect(true);
    }

    // 3. Cleanup Maps
    const room = this.roomToUsers.get(roomId);
    if (room) {
      for (const [socketId, participant] of room.entries()) {
        this.userIdToRoom.delete(participant.userId);
      }
      this.roomToUsers.delete(roomId);
    }

    console.log(`[EventsGateway] Room ${roomId} deleted and users disconnected.`);
  }
}
