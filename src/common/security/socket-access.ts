import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { In, Repository } from 'typeorm';

import { User, UserStatus } from '../../modules/users/user.entity';
import { AuthSessionsService } from '../../modules/auth/auth-sessions.service';

import { AccessPrincipal, verifyAccessToken } from './access-token';

interface Connection {
  client: Socket;
  token: string;
  principal: AccessPrincipal;
  timer?: ReturnType<typeof setTimeout>;
}

/** Owns expiry timers; never treats a past handshake as current authorization. */
export class SocketAccess {
  private readonly connections = new Map<string, Connection>();

  constructor(private readonly jwt: JwtService, private readonly users: Repository<User>, private readonly sessions: AuthSessionsService) {}

  async connect(client: Socket, token: string): Promise<AccessPrincipal> {
    const principal = await verifyAccessToken(this.jwt, this.users, token, this.sessions);
    if (client.connected === false) throw new UnauthorizedException('Socket disconnected');
    this.release(client);
    const connection: Connection = { client, token, principal };
    this.connections.set(client.id, connection);
    this.armExpiry(connection);
    client.use((_packet, next) => {
      void this.authorize(client).then(() => next(), () => next(new Error('Socket authentication required')));
    });
    return principal;
  }

  async authorize(client: Socket): Promise<AccessPrincipal> {
    const connection = this.connections.get(client.id);
    if (!connection || connection.client !== client || client.connected === false) {
      throw new UnauthorizedException('Socket authentication required');
    }
    try {
      const principal = await verifyAccessToken(this.jwt, this.users, connection.token, this.sessions);
      if (!this.isCurrent(connection)) {
        throw new UnauthorizedException('Socket disconnected');
      }
      return principal;
    } catch (error) {
      this.close(connection);
      throw error;
    }
  }

  async authorizedIds(userId?: string, roomId?: string): Promise<string[]> {
    const candidates = [...this.connections.values()].filter(connection =>
      (!userId || connection.principal.userId === userId) && (!roomId || connection.client.rooms.has(roomId)));
    if (!candidates.length) return [];
    const userIds = [...new Set(candidates.map(connection => connection.principal.userId))];
    let activeUsers: User[];
    try {
      activeUsers = await this.users.find({ where: { id: In(userIds), status: UserStatus.ACTIVE }, select: { id: true, status: true } });
    } catch {
      this.closeAll(candidates);
      return [];
    }
    let sessionKeys: Set<string>;
    try { sessionKeys = await this.sessions.activeKeys(candidates.map(connection => connection.principal)); }
    catch { this.closeAll(candidates); return []; }
    const activeIds = new Set(activeUsers.filter(user => user.status === UserStatus.ACTIVE).map(user => user.id));
    const permitted = candidates.filter(connection => this.isCurrent(connection) &&
      connection.principal.exp * 1000 > Date.now() && activeIds.has(connection.principal.userId) &&
      sessionKeys.has(`${connection.principal.sid}:${connection.principal.sub}`));
    const permittedSet = new Set(permitted);
    this.closeAll(candidates.filter(connection => !permittedSet.has(connection)));
    return permitted.filter(connection => this.isCurrent(connection)).map(connection => connection.client.id);
  }

  release(client: Socket): void {
    const connection = this.connections.get(client.id);
    if (!connection || connection.client !== client) return;
    if (connection.timer) clearTimeout(connection.timer);
    this.connections.delete(client.id);
  }

  destroy(): void {
    this.closeAll([...this.connections.values()]);
  }

  private armExpiry(connection: Connection): void {
    const remaining = connection.principal.exp * 1000 - Date.now();
    if (remaining <= 0) { this.close(connection); return; }
    connection.timer = setTimeout(() => {
      if (this.connections.get(connection.client.id) === connection) this.armExpiry(connection);
    }, Math.min(remaining, 2_147_483_647));
    connection.timer.unref?.();
  }

  private isCurrent(connection: Connection): boolean {
    return this.connections.get(connection.client.id) === connection && connection.client.connected !== false;
  }

  private close(connection: Connection): void {
    this.closeAll([connection]);
  }

  private closeAll(connections: Connection[]): void {
    const clients: Socket[] = [];
    for (const connection of connections) {
      if (this.connections.get(connection.client.id) !== connection) continue;
      this.release(connection.client);
      clients.push(connection.client);
    }
    // Remove the complete denied set before disconnect callbacks can broadcast
    // presence, avoiding a cascade of repeated checks during an outage.
    for (const client of clients) client.disconnect(true);
  }
}
