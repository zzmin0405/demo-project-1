import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) { }

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient<Socket>();
    const token = client.handshake.auth.token;

    if (!token) {
      console.error('Socket Auth Error: No token provided');
      return false;
    }

    // TEMPORARY FIX: Trust the token as the userId (email) since we migrated to NextAuth
    // and are sending the email directly from the client.
    // TODO: Implement proper server-side session verification with Prisma.
    client['user'] = { sub: token, email: token };
    return true;
  }
}
