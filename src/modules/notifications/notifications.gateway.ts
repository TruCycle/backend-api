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
import { resolveOutwardPostcode } from '../../common/utils/postcode';
import { safeFailure } from '../../common/utils/safe-log';
import { User } from '../users/user.entity';
import { AuthSessionsService } from '../auth/auth-sessions.service';

import { NotificationViewModel } from './notification.entity';
import { NotificationsService } from './notifications.service';

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
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly access: SocketAccess;

  constructor(
    jwt: JwtService,
    @Inject(forwardRef(() => NotificationsService)) private readonly notifications: NotificationsService,
    @InjectRepository(User) users: Repository<User>,
    sessions: AuthSessionsService,
  ) { this.access = new SocketAccess(jwt, users, sessions); }

  onModuleDestroy(): void { this.access.destroy(); }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const { userId } = await this.access.connect(client, token);
      client.data.userId = userId;
      client.emit('auth:ready');
      this.logger.verbose({ operation: 'notifications_socket_connected' });
    } catch (error) {
      this.logger.warn(safeFailure('notifications_socket_handshake', error));
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.access.release(client);
    const userId = client.data?.userId as string | undefined;
    if (userId) {
      this.logger.verbose({ operation: 'notifications_socket_disconnected' });
    }
  }

  async emitToUser(userId: string, notification: NotificationViewModel): Promise<void> {
    const socketIds = await this.access.authorizedIds(userId);
    if (socketIds.length === 0) return;
    this.server.to(socketIds).emit('notification:new', notification);
  }

  /**
   * Broadcast a rescue or fly-tip event to every connected client. Used by the
   * found-items module to power the live rescue ticker on the dashboard.
   */
  async broadcastRescue(
    kind: 'rescue' | 'flytip',
    payload: {
      id: string;
      title: string;
      category?: string | null;
      postcode?: string | null;
      co2eKg?: number | null;
      impactPoints?: number | null;
      rescuerName?: string | null;
      imageUrl?: string | null;
      ts?: string;
    },
  ): Promise<void> {
    if (!this.server) return;
    const socketIds = await this.access.authorizedIds();
    if (!socketIds.length) return;
    const event = kind === 'flytip' ? 'rescue:flytip' : 'rescue:new';
    this.server.to(socketIds).emit(event, {
      ...payload,
      postcode: resolveOutwardPostcode(payload.postcode),
      ts: payload.ts ?? new Date().toISOString(),
    });
  }

  @SubscribeMessage('notification:read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReadPayload,
  ): Promise<{ event: string; data: any }> {
    const { userId } = await this.access.authorize(client);
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

}

