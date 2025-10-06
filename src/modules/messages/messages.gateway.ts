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

interface SendMessageFilePayload {
  name: string; // original file name
  type: string; // mime type
  data: string; // base64-encoded content
}

interface SendMessagePayload {
  roomId: string;
  text?: string;
  files?: SendMessageFilePayload[];
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
      const socketIds = this.findSocketIdsForUser(payload.userId);
      if (socketIds.length === 0) continue;
      this.server.in(socketIds).socketsJoin(roomId);
      this.server.to(socketIds).emit('message:new', payload.message);
    }
    this.server.to(roomId).emit('room:activity', { roomId, updatedAt: new Date().toISOString() });
  }

  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessagePayload,
  ): Promise<{ event: string; data: any }> {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      throw new UnauthorizedException('Unauthenticated socket');
    }
    if (!payload?.roomId) {
      throw new BadRequestException('roomId is required');
    }

    // Ensure the sender socket is in the room to receive room-scoped broadcasts
    client.join(payload.roomId);

    let primaryMessage: MessageViewModel | null = null;

    // Optional direct text message (only when no files are attached)
    if (payload.text && payload.text.trim() && !(Array.isArray(payload.files) && payload.files.length > 0)) {
      primaryMessage = await this.messages.createDirectTextMessage(
        payload.roomId,
        userId,
        payload.text,
      );
    }

    // Optional image attachments (multiple). Each attachment is emitted as its own message.
    if (Array.isArray(payload.files) && payload.files.length > 0) {
      let first = true;
      for (const f of payload.files) {
        if (!f?.data || !f?.type || !f?.name) continue;
        if (!f.type.toLowerCase().startsWith('image/')) {
          throw new BadRequestException('Only image files are permitted');
        }
        const buffer = Buffer.from(f.data, 'base64');
        const view = await this.messages.sendImageMessage(payload.roomId, userId, {
          buffer,
          originalname: f.name,
          mimetype: f.type,
        } as any, { caption: first && payload.text ? payload.text.trim() : null } as any);
        if (first && !primaryMessage) {
          primaryMessage = view;
        }
        first = false;
      }
    }

    if (!primaryMessage) {
      // No text provided; try to return the latest activity time via a synthetic ack
      // Clients should rely on subsequent `message:new` events for attachment echoes.
      return { event: 'message:sent', data: { success: true } } as any;
    }
    return { event: 'message:sent', data: primaryMessage };
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

  private findSocketIdsForUser(userId: string): string[] {
    const ids: string[] = [];
    for (const [socketId, mappedUser] of this.socketUser.entries()) {
      if (mappedUser === userId) {
        ids.push(socketId);
      }
    }
    return ids;
  }
}
