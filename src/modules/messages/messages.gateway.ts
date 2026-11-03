import { BadRequestException, Inject, Logger, OnModuleDestroy, UnauthorizedException, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';

import { SocketAccess } from '../../common/security/socket-access';
import { safeFailure } from '../../common/utils/safe-log';
import { User } from '../users/user.entity';
import { AuthSessionsService } from '../auth/auth-sessions.service';

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
  clientMessageId?: string;
  text?: string;
  files?: SendMessageFilePayload[];
}

@WebSocketGateway({
  cors: {
    origin:
      !process.env.CORS_ORIGINS || process.env.CORS_ORIGINS.trim() === '*'
        ? '*'
        : process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: false,
  },
  namespace: '/messages',
})
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(MessagesGateway.name);
  private readonly socketUser = new Map<string, string>();
  private readonly access: SocketAccess;

  constructor(
    jwt: JwtService,
    private readonly presence: MessagesPresenceService,
    @Inject(forwardRef(() => MessagesService)) private readonly messages: MessagesService,
    @InjectRepository(User) users: Repository<User>,
    sessions: AuthSessionsService,
  ) { this.access = new SocketAccess(jwt, users, sessions); }

  onModuleDestroy(): void { this.access.destroy(); }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const { userId } = await this.access.connect(client, token);
      client.data.userId = userId;
      this.socketUser.set(client.id, userId);
      client.emit('auth:ready');
      const becameOnline = this.presence.markOnline(userId, client.id);
      if (becameOnline) {
        await this.broadcastPresence(userId, true);
      }
      this.logger.verbose({ operation: 'messages_socket_connected' });
    } catch (error) {
      this.logger.warn(safeFailure('messages_socket_handshake', error));
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.access.release(client);
    const userId = this.socketUser.get(client.id) ?? (client.data?.userId as string | undefined);
    if (userId) {
      const becameOffline = this.presence.markOffline(userId, client.id);
      if (becameOffline) {
        await this.broadcastPresence(userId, false);
      }
      this.socketUser.delete(client.id);
      this.logger.verbose({ operation: 'messages_socket_disconnected' });
    }
  }

  @SubscribeMessage('room:join')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinRoomPayload,
  ): Promise<{ event: string; data: any }> {
    const { userId } = await this.access.authorize(client);
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

  async broadcastMessage(roomId: string, payloads: BroadcastPayload[]): Promise<void> {
    for (const payload of payloads) {
      const socketIds = await this.access.authorizedIds(payload.userId);
      if (socketIds.length === 0) continue;
      this.server.in(socketIds).socketsJoin(roomId);
      this.server.to(socketIds).emit('message:new', payload.message);
    }
    const roomSockets = await this.access.authorizedIds(undefined, roomId);
    if (roomSockets.length) this.server.to(roomSockets).emit('room:activity', { roomId, updatedAt: new Date().toISOString() });
  }

  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessagePayload,
  ): Promise<{ event: string; data: any }> {
    const { userId } = await this.access.authorize(client);
    if (!payload?.roomId) {
      throw new BadRequestException('roomId is required');
    }

    // Ensure the sender socket is in the room to receive room-scoped broadcasts
    await this.messages.getRoomOrFail(payload.roomId, userId);
    client.join(payload.roomId);

    let primaryMessage: MessageViewModel | null = null;

    // Optional direct text message (only when no files are attached)
    if (payload.text && payload.text.trim() && !(Array.isArray(payload.files) && payload.files.length > 0)) {
      primaryMessage = await this.messages.createDirectTextMessage(
        payload.roomId,
        userId,
        payload.text,
        payload.clientMessageId,
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
      throw new BadRequestException('Message text or an image is required');
    }
    return { event: 'message:sent', data: primaryMessage };
  }

  async emitRoomCleared(roomId: string): Promise<void> {
    const ids = await this.access.authorizedIds(undefined, roomId);
    if (ids.length) this.server.to(ids).emit('room:cleared', { roomId });
  }

  async emitRoomDeleted(roomId: string): Promise<void> {
    const ids = await this.access.authorizedIds(undefined, roomId);
    if (ids.length) this.server.to(ids).emit('room:deleted', { roomId });
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

  private async broadcastPresence(userId: string, online: boolean): Promise<void> {
    const ids = await this.access.authorizedIds();
    if (ids.length) this.server.to(ids).emit('presence:update', { userId, online });
  }
}
