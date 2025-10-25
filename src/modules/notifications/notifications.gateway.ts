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

import { NotificationsService } from './notifications.service';
import { NotificationViewModel } from './notification.entity';

interface ReadPayload {
  id?: string;
  ids?: string[];
}

@WebSocketGateway({
  cors: {
    origin:
      !process.env.CORS_ORIGINS || process.env.CORS_ORIGINS.trim() === '*'
        ? '*'
        : process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: false,
  },
  namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly socketUser = new Map<string, string>();

  constructor(
    private readonly jwt: JwtService,
    @Inject(forwardRef(() => NotificationsService)) private readonly notifications: NotificationsService,
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
      this.logger.verbose(`Notifications socket ${client.id} connected for user ${userId}`);
    } catch (error) {
      this.logger.warn(`Disconnecting notifications socket during handshake: ${error}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = this.socketUser.get(client.id) ?? (client.data?.userId as string | undefined);
    if (userId) {
      this.socketUser.delete(client.id);
      this.logger.verbose(`Notifications socket ${client.id} disconnected for user ${userId}`);
    }
  }

  emitToUser(userId: string, notification: NotificationViewModel): void {
    const socketIds = this.findSocketIdsForUser(userId);
    if (socketIds.length === 0) return;
    this.server.to(socketIds).emit('notification:new', notification);
  }

  @SubscribeMessage('notification:read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReadPayload,
  ): Promise<{ event: string; data: any }> {
    const userId = client.data.userId as string | undefined;
    if (!userId) throw new UnauthorizedException('Unauthenticated socket');
    if (!payload || (!payload.id && !Array.isArray(payload.ids))) {
      throw new BadRequestException('id or ids is required');
    }
    const ids = payload.id ? [payload.id] : (payload.ids || []);
    const updated = await this.notifications.markRead(userId, ids);
    return { event: 'notification:read:ack', data: { count: updated } } as any;
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
      if (token) return token;
    }
    throw new UnauthorizedException('Missing websocket token');
  }

  private findSocketIdsForUser(userId: string): string[] {
    const ids: string[] = [];
    for (const [socketId, mappedUser] of this.socketUser.entries()) {
      if (mappedUser === userId) ids.push(socketId);
    }
    return ids;
  }
}

