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

interface Participant {
  userId: string;
  username: string;
  hasVideo: boolean;
}

@UseGuards(SupabaseAuthGuard)
@WebSocketGateway({
  cors: {
    origin: '*', // For development only. Restrict this in production.
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private roomToUsers = new Map<string, Map<string, Participant>>(); // roomId -> Map<socketId, Participant>

  handleConnection(client: Socket, ...args: any[]) {
    console.log(`Client connecting: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    this.leaveRoom(client);
  }

  private leaveRoom(client: Socket) {
    for (const [roomId, users] of this.roomToUsers.entries()) {
      if (users.has(client.id)) {
        const user = users.get(client.id)!;
        users.delete(client.id);
        if (users.size === 0) {
          this.roomToUsers.delete(roomId);
        }
        this.server.to(roomId).emit('user-left', { userId: user.userId });
        console.log(`Client ${user.userId} left room ${roomId}`);
        return;
      }
    }
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(client: Socket, data: { roomId: string; username: string }): void {
    if (!client['user']?.sub) {
      console.error('Unauthorized join-room attempt: userId not found on socket.', {
        socketId: client.id,
      });
      client.emit('error', { message: 'Authentication error. Please reconnect.' });
      return;
    }

    const { roomId, username } = data;
    const userId = client['user'].sub; // Use the trusted userId from the guard

    console.log(`Authenticated client ${client.id} (userId: ${userId}) attempting to join room ${roomId}`);

    if (!this.roomToUsers.has(roomId)) {
      this.roomToUsers.set(roomId, new Map<string, Participant>());
    }
    const room = this.roomToUsers.get(roomId)!;

    // Get other users' data including their socketId
    const otherUsers = Array.from(room.entries()).map(([socketId, participant]) => ({
      ...participant,
      socketId,
    }));

    // Add the new user
    room.set(client.id, { userId, username, hasVideo: true });
    client.join(roomId);

    // 1. Send the list of other participants (with socketIds) back to the new user.
    client.emit('room-state', { roomId, participants: otherUsers });

    // 2. Notify everyone else that a new user has joined (with their socketId).
    client.to(roomId).emit('user-joined', { userId, username, hasVideo: true, socketId: client.id });

    console.log(`Client ${userId} (${username}) joined room ${roomId}.`);
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(client: Socket): void {
    this.leaveRoom(client);
  }

  @SubscribeMessage('media-chunk')
  handleMediaChunk(client: Socket, chunk: Buffer): void {
    const [socketId, roomId] = Array.from(client.rooms);

    if (roomId) {
      client.to(roomId).emit('media-chunk', {
        socketId: client.id,
        chunk: chunk,
      });
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
}
