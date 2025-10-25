import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*', // For development only. Restrict this in production.
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket, ...args: any[]) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(client: Socket, room: string): void {
    client.join(room);
    client.to(room).emit('user_joined', { userId: client.id });
    console.log(`Client ${client.id} joined room ${room}`);
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(client: Socket, room: string): void {
    client.leave(room);
    client.to(room).emit('user_left', { userId: client.id });
    console.log(`Client ${client.id} left room ${room}`);
  }
}
