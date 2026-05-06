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
  canBroadcast?: boolean;
  avatar_url?: string;
}

interface DeepgramSubtitleSession {
  socket: WebSocket;
  roomId: string;
  client: Socket;
  sequence: number;
  currentSpeechStartedAt?: number;
}

type SubtitleLang = 'all' | 'ko' | 'en' | 'ja' | 'zh';
type SubtitleDisplayLang = Exclude<SubtitleLang, 'all'>;
type BroadcastMode = 'single' | 'all';
type TranslationMap = {
  ko: string;
  en: string;
  ja: string;
  zh: string;
};
type SubtitleTranslationResult = {
  translations: TranslationMap;
  complete: boolean;
};

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
  @WebSocketServer()
  server: Server;

  private readonly subtitleTranslateTimeoutMs = 2400;
  private readonly subtitleCacheLimit = 300;
  private readonly subtitleTranslationCache = new Map<string, TranslationMap>();
  private readonly activeSubtitleSessions = new Map<string, { id: string; sequence: number }>();
  private readonly deepgramSubtitleSessions = new Map<string, DeepgramSubtitleSession>();
  private readonly subtitleLanguageBySocketId = new Map<string, SubtitleDisplayLang[]>();

  private roomToUsers = new Map<string, Map<string, Participant>>(); // roomId -> Map<socketId, Participant>
  private userIdToRoom = new Map<string, string>(); // userId -> roomId
  private broadcastPresenterByRoom = new Map<string, string>(); // roomId -> userId
  private broadcastModeByRoom = new Map<string, BroadcastMode>(); // roomId -> mode

  constructor(private prisma: PrismaService) { }

  private getParticipantsWithSocketIds(roomId: string): (Participant & { socketId: string })[] {
    return Array.from(this.roomToUsers.get(roomId)?.entries() || []).map(([socketId, participant]) => ({
      ...participant,
      socketId,
    }));
  }

  private emitParticipantListChanged(roomId: string): void {
    const room = this.roomToUsers.get(roomId);
    if (!room) return;

    this.server.to(roomId).emit('participant-list-changed', {
      participants: this.getParticipantsWithSocketIds(roomId),
      presenterUserId: this.broadcastPresenterByRoom.get(roomId),
      broadcastMode: this.broadcastModeByRoom.get(roomId) ?? 'single',
    });
  }

  handleConnection(client: Socket, ...args: any[]) {
    const token = client.handshake.auth.token;
    const userId = client['user']?.sub || token; // Fallback if guard hasn't run yet (it should have)
    console.log(`[ConnectionDebug] Client connected: ${client.id}, Token/UserId: ${userId}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    this.stopDeepgramSubtitleSession(client.id);
    this.subtitleLanguageBySocketId.delete(client.id);
    this.leaveRoom(client);
  }
  @SubscribeMessage('media-chunk')
  handleMediaChunk(client: Socket, payload: { chunk: any, mimeType?: string; timestamp?: number } | any): void {
    const roomId = Array.from(client.rooms).find(r => r !== client.id);
    const userId = client['user']?.sub || client.handshake.auth.token;

    // console.log(`[MediaChunkDebug] Received from ${client.id} (User: ${userId}) for Room ${roomId}`);

    if (roomId) {
      const room = this.roomToUsers.get(roomId);
      const participant = room?.get(client.id);
      if (!participant?.canBroadcast) {
        return;
      }

      const chunk = payload.chunk || payload;
      const mimeType = payload.mimeType || 'video/webm; codecs="vp8, opus"';

      client.to(roomId).emit('media-chunk', {
        socketId: client.id,
        userId: userId, // Explicitly send userId to prevent mapping errors
        chunk: chunk,
        mimeType: mimeType,
        timestamp: payload.timestamp,
      });
    }
  }

  @SubscribeMessage('chat-message')
  async handleChatMessage(client: Socket, data: { roomId: string; message: string }): Promise<void> {
    console.log(`[ChatDebug] Received message from ${client.id} for room ${data.roomId}: ${data.message}`);
    const userId = client['user']?.sub;
    if (!userId) {
      console.error(`[ChatDebug] No userId for client ${client.id}`);
      return;
    }

    let room = this.roomToUsers.get(data.roomId);
    if (!room) {
      console.log(`[ChatDebug] Room ${data.roomId} not in memory. Checking DB...`);
      const meetingRoom = await this.prisma.meetingRoom.findUnique({
        where: { id: data.roomId }
      });

      if (!meetingRoom) {
        const availableRooms = Array.from(this.roomToUsers.keys()).join(', ');
        console.error(`[ChatDebug] Room ${data.roomId} not found in DB. Available: ${availableRooms}`);
        client.emit('chat-error', { message: `Room not found. Available: ${availableRooms}` });
        return;
      }

      // Initialize room in memory
      room = new Map<string, Participant>();
      this.roomToUsers.set(data.roomId, room);
      console.log(`[ChatDebug] Room ${data.roomId} lazy-loaded from DB.`);
    }

    let participant = room.get(client.id);
    if (!participant) {
      console.log(`[ChatDebug] Participant not in memory for client ${client.id}. Checking DB...`);
      const dbParticipant = await this.prisma.participant.findUnique({
        where: {
          userId_meetingRoomId: {
            userId: userId,
            meetingRoomId: data.roomId
          }
        },
        include: { user: true }
      });

      if (dbParticipant) {
        // Auto-rejoin the participant into memory
        participant = {
          userId: dbParticipant.userId,
          username: dbParticipant.user.name || 'Anonymous',
          avatar_url: dbParticipant.user.image || undefined,
          hasVideo: !dbParticipant.isVideoOff,
          isMuted: dbParticipant.isMuted
        };
        room.set(client.id, participant);
        this.userIdToRoom.set(userId, data.roomId);
        client.join(data.roomId);
        console.log(`[ChatDebug] Participant ${userId} auto-rejoined into memory.`);
      } else {
        console.error(`[ChatDebug] Participant ${userId} not found in DB for room ${data.roomId}`);
        client.emit('chat-error', { message: 'Participant not found in room. Please refresh.' });
        return;
      }
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
          this.broadcastPresenterByRoom.delete(roomId);
          this.broadcastModeByRoom.delete(roomId);
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
        this.emitParticipantListChanged(roomId);
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
    let userId = client['user'].sub; // Use the trusted userId from the guard

    // Resolve User ID if token is an email
    if (userId.includes('@')) {
      const user = await this.prisma.user.findUnique({ where: { email: userId } });
      if (user) {
        userId = user.id;
        // CRITICAL FIX: Update the socket's user object so subsequent events (chat, etc.) use the correct UUID
        client['user'].sub = userId;
        console.log(`[Auth] Resolved email ${client['user'].email} to userId ${userId}`);
      } else {
        console.warn(`[Auth] User with email ${userId} not found in DB. Treating as guest/anonymous.`);
      }
    }

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

            console.log(`[Auto-Kick] Found stale socket ${oldSocketId} for user ${userId} in room ${existingRoomId}. Cleaning up silently.`);

            const oldSocket = this.server.sockets.sockets.get(oldSocketId);
            if (oldSocket) {
              this.leaveRoom(oldSocket, true); // Silent leave to prevent user-left race condition
              oldSocket.disconnect(true); // Disconnect without error - this is normal reconnection behavior
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

    // Get meeting metadata before publishing participant state so the creator is the only broadcaster.
    const roomInfo = await this.prisma.meetingRoom.findUnique({
      where: { id: roomId },
      select: { title: true, creatorId: true }
    });
    if (roomInfo?.creatorId && !this.broadcastPresenterByRoom.has(roomId)) {
      this.broadcastPresenterByRoom.set(roomId, roomInfo.creatorId);
    }
    if (!this.broadcastModeByRoom.has(roomId)) {
      this.broadcastModeByRoom.set(roomId, 'single');
    }
    const broadcastMode = this.broadcastModeByRoom.get(roomId) ?? 'single';
    const currentPresenterUserId = this.broadcastPresenterByRoom.get(roomId);
    const canBroadcast = broadcastMode === 'all' || currentPresenterUserId === userId;

    // Get other users' data including their socketId
    const otherUsers = this.getParticipantsWithSocketIds(roomId);

    // Add the new user
    room.set(client.id, { userId, username, hasVideo: canBroadcast ? hasVideo : false, isMuted: canBroadcast ? isMuted : true, avatar_url, canBroadcast });
    this.userIdToRoom.set(userId, roomId); // Track user's room
    client.join(roomId);

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
      hostId: roomInfo?.creatorId,
      canBroadcast,
      broadcastMode,
    });

    // 2. Notify everyone else that a new user has joined (with their socketId).
    client.to(roomId).emit('user-joined', { userId, username, hasVideo: canBroadcast ? hasVideo : false, isMuted: canBroadcast ? isMuted : true, avatar_url, canBroadcast, socketId: client.id });
    this.emitParticipantListChanged(roomId);

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


  @SubscribeMessage('camera-state-changed')
  handleCameraStateChanged(client: Socket, data: { roomId: string; userId: string; hasVideo: boolean }): void {
    // Update server state
    const room = this.roomToUsers.get(data.roomId);
    const participant = room?.get(client.id);
    if (!participant?.canBroadcast) return;

    if (room && room.has(client.id)) {
      if (participant) {
        participant.hasVideo = data.hasVideo;
      }
    }

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
    const participant = room?.get(client.id);
    if (!participant?.canBroadcast) return;

    if (room && room.has(client.id)) {
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

  @SubscribeMessage('set-broadcast-presenter')
  async handleSetBroadcastPresenter(client: Socket, data: { roomId: string; targetUserId: string }): Promise<void> {
    const requesterUserId = client['user']?.sub;
    if (!requesterUserId || !data.targetUserId) return;

    const meetingRoom = await this.prisma.meetingRoom.findUnique({
      where: { id: data.roomId },
      select: { creatorId: true },
    });
    if (!meetingRoom || meetingRoom.creatorId !== requesterUserId) {
      client.emit('error', { message: 'Only the host can change the speaker.' });
      return;
    }

    const room = this.roomToUsers.get(data.roomId);
    if (!room) return;

    this.broadcastModeByRoom.set(data.roomId, 'single');
    let targetFound = false;
    for (const [socketId, participant] of room.entries()) {
      const shouldBroadcast = participant.userId === data.targetUserId;
      participant.canBroadcast = shouldBroadcast;

      if (shouldBroadcast) {
        targetFound = true;
      } else {
        participant.hasVideo = false;
        participant.isMuted = true;
        this.stopDeepgramSubtitleSession(socketId);
      }
    }

    if (!targetFound) {
      client.emit('error', { message: 'Selected participant is not in this room.' });
      return;
    }

    this.broadcastPresenterByRoom.set(data.roomId, data.targetUserId);
    const participants = this.getParticipantsWithSocketIds(data.roomId);

    this.server.to(data.roomId).emit('broadcast-presenter-changed', {
      presenterUserId: data.targetUserId,
      broadcastMode: 'single',
      participants,
    });
    this.emitParticipantListChanged(data.roomId);

    console.log(`[Presenter] Host ${requesterUserId} changed presenter to ${data.targetUserId} in room ${data.roomId}`);
  }

  @SubscribeMessage('set-broadcast-mode')
  async handleSetBroadcastMode(client: Socket, data: { roomId: string; mode: BroadcastMode }): Promise<void> {
    const requesterUserId = client['user']?.sub;
    if (!requesterUserId || !['single', 'all'].includes(data.mode)) return;

    const meetingRoom = await this.prisma.meetingRoom.findUnique({
      where: { id: data.roomId },
      select: { creatorId: true },
    });
    if (!meetingRoom || meetingRoom.creatorId !== requesterUserId) {
      client.emit('error', { message: 'Only the host can change broadcast mode.' });
      return;
    }

    const room = this.roomToUsers.get(data.roomId);
    if (!room) return;

    this.broadcastModeByRoom.set(data.roomId, data.mode);
    const presenterUserId = data.mode === 'single'
      ? (this.broadcastPresenterByRoom.get(data.roomId) ?? meetingRoom.creatorId)
      : undefined;

    if (data.mode === 'single') {
      this.broadcastPresenterByRoom.set(data.roomId, presenterUserId ?? meetingRoom.creatorId);
    }

    for (const [socketId, participant] of room.entries()) {
      const shouldBroadcast = data.mode === 'all' || participant.userId === presenterUserId;
      participant.canBroadcast = shouldBroadcast;

      if (!shouldBroadcast) {
        participant.hasVideo = false;
        participant.isMuted = true;
        this.stopDeepgramSubtitleSession(socketId);
      }
    }

    const participants = this.getParticipantsWithSocketIds(data.roomId);
    this.server.to(data.roomId).emit('broadcast-mode-changed', {
      broadcastMode: data.mode,
      presenterUserId,
      participants,
    });
    this.emitParticipantListChanged(data.roomId);

    console.log(`[Presenter] Host ${requesterUserId} changed broadcast mode to ${data.mode} in room ${data.roomId}`);
  }

  @SubscribeMessage('subtitle-language-changed')
  handleSubtitleLanguageChanged(client: Socket, data: { roomId: string; lang?: SubtitleLang; langs?: SubtitleDisplayLang[] }): void {
    if (!this.roomToUsers.get(data.roomId)?.has(client.id)) return;

    const validLanguages: SubtitleDisplayLang[] = ['ko', 'en', 'ja', 'zh'];
    const requestedLanguages = Array.isArray(data.langs)
      ? data.langs.filter((lang): lang is SubtitleDisplayLang => validLanguages.includes(lang))
      : data.lang === 'all'
        ? validLanguages
        : data.lang && validLanguages.includes(data.lang as SubtitleDisplayLang)
          ? [data.lang as SubtitleDisplayLang]
          : validLanguages;

    this.subtitleLanguageBySocketId.set(client.id, requestedLanguages.length > 0 ? requestedLanguages : validLanguages);
  }

  @SubscribeMessage('speaking-start')
  handleSpeakingStart(client: Socket, data: { roomId: string; userId: string }): void {
    const participant = this.roomToUsers.get(data.roomId)?.get(client.id);
    if (!participant?.canBroadcast) return;
    client.to(data.roomId).emit('speaking-start', { userId: data.userId });
  }

  @SubscribeMessage('speaking-stop')
  handleSpeakingStop(client: Socket, data: { roomId: string; userId: string }): void {
    const participant = this.roomToUsers.get(data.roomId)?.get(client.id);
    if (!participant?.canBroadcast) return;
    client.to(data.roomId).emit('speaking-stop', { userId: data.userId });
  }

  @SubscribeMessage('stream-reset')
  handleStreamReset(client: Socket, data: { roomId: string; userId: string }): void {
    const participant = this.roomToUsers.get(data.roomId)?.get(client.id);
    if (!participant?.canBroadcast) return;
    // Broadcast stream reset to other users so they can clear their buffers
    client.to(data.roomId).emit('stream-reset', { userId: data.userId });
  }

  @SubscribeMessage('request-keyframe')
  handleRequestKeyframe(client: Socket, data: { roomId: string; userId: string }): void {
    // Forward the request to the specific user (data.userId is the TARGET, i.e., the sender)
    // We need to find the socketId for this userId
    const room = this.roomToUsers.get(data.roomId);
    if (room) {
      for (const [socketId, participant] of room.entries()) {
        if (participant.userId === data.userId) {
          this.server.to(socketId).emit('request-keyframe', { fromUserId: client['user']?.sub });
          break;
        }
      }
    }
  }

  @SubscribeMessage('stt-recognize')
  async handleSttRecognize(client: Socket, data: { roomId: string; text: string; sourceLang?: string; clientTimestamp?: number; isFinal?: boolean; sequence?: number }): Promise<void> {
    const serverReceivedAt = Date.now();
    const translationStartedAt = serverReceivedAt;
    const userId = client['user']?.sub;
    if (!userId || !data.text) return;
    const { roomId, text, sourceLang, clientTimestamp, isFinal = true } = data;
    const participant = this.roomToUsers.get(roomId)?.get(client.id);
    if (!participant?.canBroadcast) return;

    // Get the speaker's username
    let userName = 'Unknown';
    const room = this.roomToUsers.get(data.roomId);
    if (room && room.has(client.id)) {
      userName = room.get(client.id)!.username;
    }

    const sessionKey = `${roomId}:${userId}`;
    let subtitleSession = this.activeSubtitleSessions.get(sessionKey);
    const isNewSubtitleSession = !subtitleSession;
    if (!subtitleSession) {
      subtitleSession = {
        id: Math.random().toString(36).substr(2, 9),
        sequence: 0,
      };
      this.activeSubtitleSessions.set(sessionKey, subtitleSession);
    }

    const sequence = data.sequence ?? subtitleSession.sequence + 1;
    subtitleSession.sequence = Math.max(subtitleSession.sequence, sequence);
    const subtitleId = subtitleSession.id;

    const streamPayload = {
      id: subtitleId,
      userId,
      userName,
      originalText: text,
      sequence,
      isFinal,
      clientTimestamp,
      serverReceivedAt,
      translationStartedAt,
    };

    this.server.to(data.roomId).emit(isNewSubtitleSession ? 'subtitle-stream-start' : 'subtitle-stream-update', streamPayload);

    try {
      const requestedLanguages = this.getRequestedSubtitleLanguages(roomId);
      const cacheKey = this.getSubtitleCacheKey(text, sourceLang, requestedLanguages);
      const cachedTranslations = this.subtitleTranslationCache.get(cacheKey);
      const translationResult = cachedTranslations
        ? { translations: cachedTranslations, complete: true }
        : await this.translateSubtitleText(text, requestedLanguages);
      const translations = translationResult.translations;

      if (!cachedTranslations && translationResult.complete) {
        this.rememberSubtitleTranslation(cacheKey, translations);
      } else if (!cachedTranslations) {
        console.warn(`[Translate] Partial result was not cached for "${text}"`);
      }

      console.log(`[Translate] ✅ (${sourceLang || 'auto'}) "${text}" → KO: "${translations.ko}" | EN: "${translations.en}" | JA: "${translations.ja}" | ZH: "${translations.zh}"`);

      const latestSession = this.activeSubtitleSessions.get(sessionKey);
      if (!latestSession || latestSession.id !== subtitleId || latestSession.sequence !== sequence) {
        return;
      }

      const translationFinishedAt = Date.now();
      this.server.to(roomId).emit(isFinal ? 'subtitle-broadcast' : 'subtitle-stream-update', {
        id: subtitleId, userId, userName,
        originalText: text,
        sourceLang,
        sequence,
        isFinal,
        ...translations,
        clientTimestamp,
        serverReceivedAt,
        translationStartedAt,
        translationFinishedAt,
      });

      if (isFinal) {
        this.activeSubtitleSessions.delete(sessionKey);
      }

    } catch (error) {
      console.error('[Translate] ❌ Google Translate error:', error);
      const translationFinishedAt = Date.now();
      this.server.to(roomId).emit(isFinal ? 'subtitle-broadcast' : 'subtitle-stream-update', {
        id: subtitleId, userId, userName,
        originalText: text,
        sourceLang,
        sequence,
        isFinal,
        ko: text, en: text, ja: text, zh: text,
        clientTimestamp,
        serverReceivedAt,
        translationStartedAt,
        translationFinishedAt,
      });

      if (isFinal) {
        this.activeSubtitleSessions.delete(sessionKey);
      }
    }
  }

  @SubscribeMessage('subtitle-stt-start')
  handleSubtitleSttStart(client: Socket, data: { roomId: string; sourceLang?: string }): void {
    const participant = this.roomToUsers.get(data.roomId)?.get(client.id);
    if (!participant?.canBroadcast) {
      client.emit('stt-provider-state', {
        provider: 'browser',
        enabled: false,
        reason: 'receive-only',
      });
      return;
    }

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      client.emit('stt-provider-state', {
        provider: 'browser',
        enabled: false,
        reason: 'missing-deepgram-key',
      });
      return;
    }

    this.stopDeepgramSubtitleSession(client.id);

    const params = new URLSearchParams({
      model: process.env.DEEPGRAM_STT_MODEL || 'nova-3',
      interim_results: 'true',
      endpointing: process.env.DEEPGRAM_ENDPOINTING_MS || '300',
      punctuate: 'true',
      smart_format: 'true',
    });
    const deepgramLanguage = this.toDeepgramLanguage(data.sourceLang);
    if (deepgramLanguage) params.set('language', deepgramLanguage);

    try {
      const deepgramSocket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ['token', apiKey]);
      const session: DeepgramSubtitleSession = {
        socket: deepgramSocket,
        roomId: data.roomId,
        client,
        sequence: 0,
      };
      this.deepgramSubtitleSessions.set(client.id, session);

      deepgramSocket.addEventListener('open', () => {
        client.emit('stt-provider-state', {
          provider: 'deepgram',
          enabled: true,
          model: params.get('model'),
        });
      });

      deepgramSocket.addEventListener('message', (event) => {
        this.handleDeepgramMessage(client.id, event.data);
      });

      deepgramSocket.addEventListener('error', (error) => {
        console.error('[Deepgram] WebSocket error:', error);
        client.emit('stt-provider-state', {
          provider: 'browser',
          enabled: false,
          reason: 'deepgram-error',
        });
      });

      deepgramSocket.addEventListener('close', () => {
        if (this.deepgramSubtitleSessions.get(client.id)?.socket === deepgramSocket) {
          this.deepgramSubtitleSessions.delete(client.id);
          client.emit('stt-provider-state', {
            provider: 'browser',
            enabled: false,
            reason: 'deepgram-closed',
          });
        }
      });
    } catch (error) {
      console.error('[Deepgram] Failed to start stream:', error);
      client.emit('stt-provider-state', {
        provider: 'browser',
        enabled: false,
        reason: 'deepgram-start-failed',
      });
    }
  }

  @SubscribeMessage('subtitle-stt-stop')
  handleSubtitleSttStop(client: Socket): void {
    this.stopDeepgramSubtitleSession(client.id);
    client.emit('stt-provider-state', {
      provider: 'browser',
      enabled: false,
      reason: 'stopped',
    });
  }

  @SubscribeMessage('stt-audio-chunk')
  handleSubtitleAudioChunk(client: Socket, payload: { roomId: string; chunk: any; clientTimestamp?: number }): void {
    const session = this.deepgramSubtitleSessions.get(client.id);
    if (!session || session.roomId !== payload.roomId) return;

    const participant = this.roomToUsers.get(payload.roomId)?.get(client.id);
    if (!participant?.canBroadcast) return;

    if (!session.currentSpeechStartedAt && payload.clientTimestamp) {
      session.currentSpeechStartedAt = payload.clientTimestamp;
    }

    if (session.socket.readyState !== WebSocket.OPEN) return;

    const chunk = payload.chunk;
    if (chunk) {
      session.socket.send(chunk);
    }
  }

  private handleDeepgramMessage(socketId: string, rawMessage: unknown): void {
    const session = this.deepgramSubtitleSessions.get(socketId);
    if (!session) return;

    try {
      const messageText = typeof rawMessage === 'string'
        ? rawMessage
        : Buffer.from(rawMessage as ArrayBuffer).toString('utf8');
      const message = JSON.parse(messageText);
      const transcript = message.channel?.alternatives?.[0]?.transcript?.trim();
      if (!transcript) return;

      session.sequence += 1;
      const isFinal = Boolean(message.is_final || message.speech_final);
      void this.handleSttRecognize(session.client, {
        roomId: session.roomId,
        text: transcript,
        isFinal,
        sequence: session.sequence,
        clientTimestamp: session.currentSpeechStartedAt ?? Date.now(),
      });

      if (isFinal || message.speech_final) {
        session.currentSpeechStartedAt = undefined;
      }
    } catch (error) {
      console.error('[Deepgram] Failed to parse transcript:', error);
    }
  }

  private stopDeepgramSubtitleSession(socketId: string): void {
    const session = this.deepgramSubtitleSessions.get(socketId);
    if (!session) return;

    this.deepgramSubtitleSessions.delete(socketId);
    try {
      if (session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(JSON.stringify({ type: 'Finalize' }));
      }
      if (session.socket.readyState === WebSocket.OPEN || session.socket.readyState === WebSocket.CONNECTING) {
        session.socket.close();
      }
    } catch (error) {
      console.error('[Deepgram] Failed to stop stream:', error);
    }
  }

  private toDeepgramLanguage(sourceLang?: string): string | undefined {
    if (!sourceLang) return undefined;

    const languageMap: Record<string, string> = {
      'ko-KR': 'ko',
      'en-US': 'en-US',
      'ja-JP': 'ja',
      'zh-CN': 'zh-CN',
    };

    return languageMap[sourceLang] ?? sourceLang;
  }

  private getRequestedSubtitleLanguages(roomId: string): SubtitleDisplayLang[] {
    const room = this.roomToUsers.get(roomId);
    if (!room) return ['ko', 'en', 'ja', 'zh'];

    const requested = new Set<SubtitleDisplayLang>();
    for (const socketId of room.keys()) {
      const langs = this.subtitleLanguageBySocketId.get(socketId) ?? ['ko', 'en', 'ja', 'zh'];
      langs.forEach(lang => requested.add(lang));
    }

    return requested.size > 0 ? Array.from(requested) : ['ko', 'en', 'ja', 'zh'];
  }

  private getSubtitleCacheKey(text: string, sourceLang: string | undefined, languages: SubtitleDisplayLang[]): string {
    return `${sourceLang || 'auto'}:${[...languages].sort().join(',')}:${text.trim().toLowerCase()}`;
  }

  private rememberSubtitleTranslation(cacheKey: string, translations: TranslationMap): void {
    if (this.subtitleTranslationCache.size >= this.subtitleCacheLimit) {
      const oldestKey = this.subtitleTranslationCache.keys().next().value;
      if (oldestKey) this.subtitleTranslationCache.delete(oldestKey);
    }
    this.subtitleTranslationCache.set(cacheKey, translations);
  }

  private async translateSubtitleText(text: string, languages: SubtitleDisplayLang[]): Promise<SubtitleTranslationResult> {
    // Caption-only translation. Translate only languages currently requested by viewers.
    const { translate } = await import('google-translate-api-x');
    const translations: TranslationMap = {
      ko: text,
      en: text,
      ja: text,
      zh: text,
    };
    let complete = true;

    await Promise.all(languages.map(async (lang) => {
      const target = lang === 'zh' ? 'zh-CN' : lang;
      const result = await this.translateWithDeadline(
        () => translate(text, { to: target }).then(response => response.text),
        text,
        target,
      );
      translations[lang] = result.text;
      if (!result.ok) complete = false;
    }));

    return { translations, complete };
  }

  private async translateWithDeadline(request: () => Promise<string>, fallbackText: string, target: string): Promise<{ text: string; ok: boolean }> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      const translatedText = await Promise.race([
        request(),
        new Promise<string>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`translation timeout after ${this.subtitleTranslateTimeoutMs}ms`)), this.subtitleTranslateTimeoutMs);
        }),
      ]);
      return { text: translatedText, ok: true };
    } catch (error) {
      console.warn(`[Translate] ${target} failed, using original text fallback:`, error);
      return { text: fallbackText, ok: false };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
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
