import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient<Socket>();
    const token = client.handshake.auth.token;

    if (!token) {
      console.error('Socket Auth Error: No token provided');
      return false;
    }

    try {
      const secret = this.configService.get<string>('SUPABASE_JWT_SECRET');
      if (!secret) {
        console.error('Socket Auth Error: JWT secret is not configured on the server.');
        return false;
      }

      const decoded = jwt.verify(token, secret) as any;
      client['user'] = decoded; // Attach user payload to the socket object
      return true;
    } catch (error: any) {
      console.error('Socket Auth Error:', error.message, error); // Log full error object
      return false;
    }
  }
}
