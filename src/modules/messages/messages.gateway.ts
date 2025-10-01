import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { BadRequestException, Inject, Logger, UnauthorizedException, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

import { MessagesPresenceService } from './messages-presence.service';
import { MessagesService, MessageViewModel } from './messages.service';

interface JoinRoomPayload {
  otherUserId: string;
}

interface BroadcastPayload {
  userId: string;
  message: MessageViewModel;
}

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()) || '*',
    credentials: false,
  },
  namespace: '/messages',
})
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(MessagesGateway.name);
  private readonly socketUser = new Map<string, string>();

  constructor(
    private readonly jwt: JwtService,
    private readonly presence: MessagesPresenceService,
    @Inject(forwardRef(() => MessagesService)) private readonly messages: MessagesService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const payload = await this.jwt.verifyAsync(token);
      const userId = payload.sub as string | undefined;
      if (!userId) {
        throw new UnauthorizedException('Invalid token payload');
      }
      client.data.userId = userId;
      this.socketUser.set(client.id, userId);
      const becameOnline = this.presence.markOnline(userId, client.id);
      if (becameOnline) {
        this.broadcastPresence(userId, true);
      }
      this.logger.verbose(`Socket ${client.id} connected for user ${userId}`);
    } catch (error) {
      this.logger.warn(`Disconnecting socket during handshake: ${error}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = this.socketUser.get(client.id) ?? (client.data?.userId as string | undefined);
    if (userId) {
      const becameOffline = this.presence.markOffline(userId, client.id);
      if (becameOffline) {
        this.broadcastPresence(userId, false);
      }
      this.socketUser.delete(client.id);
      this.logger.verbose(`Socket ${client.id} disconnected for user ${userId}`);
    }
  }

  @SubscribeMessage('room:join')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinRoomPayload,
  ): Promise<{ event: string; data: any }> {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      throw new UnauthorizedException('Unauthenticated socket');
    }
    if (!payload?.otherUserId) {
      throw new BadRequestException('Missing other user id');
    }

    const room = await this.messages.ensureRoom(userId, payload.otherUserId);
    client.join(room.id);
    return {
      event: 'room:joined',
      data: room,
    };
  }

  broadcastMessage(roomId: string, payloads: BroadcastPayload[]): void {
    for (const payload of payloads) {
      const sockets = this.findSocketsForUser(payload.userId);
      for (const socket of sockets) {
        socket.join(roomId);
        socket.emit('message:new', payload.message);
      }
    }
    this.server.to(roomId).emit('room:activity', { roomId, updatedAt: new Date().toISOString() });
  }

  emitRoomCleared(roomId: string): void {
    this.server.to(roomId).emit('room:cleared', { roomId });
  }

  emitRoomDeleted(roomId: string): void {
    this.server.to(roomId).emit('room:deleted', { roomId });
  }

  private extractToken(client: Socket): string {
    const fromAuth = client.handshake.auth?.token as string | undefined;
    const fromQuery = client.handshake.query?.token as string | undefined;
    const header = client.handshake.headers['authorization'];
    const rawHeader = Array.isArray(header) ? header[0] : header;
    const sources = [fromAuth, fromQuery, rawHeader];
    for (const source of sources) {
      if (!source) continue;
      let token = source.trim();
      const bearer = /^Bearer\s+/i;
      while (bearer.test(token)) {
        token = token.replace(bearer, '').trim();
      }
      if (token) {
        return token;
      }
    }
    throw new UnauthorizedException('Missing websocket token');
  }

  private broadcastPresence(userId: string, online: boolean): void {
    this.server.emit('presence:update', { userId, online });
  }

  private findSocketsForUser(userId: string): Socket[] {
    const sockets: Socket[] = [];
    for (const [socketId, mappedUser] of this.socketUser.entries()) {
      if (mappedUser === userId) {
        const socket = this.server.sockets.sockets.get(socketId);
        if (socket) {
          sockets.push(socket);
        }
      }
    }
    return sockets;
  }
}
