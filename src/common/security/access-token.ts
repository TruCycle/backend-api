import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';

import { User, UserStatus } from '../../modules/users/user.entity';
import { AuthSessionsService } from '../../modules/auth/auth-sessions.service';

export interface AccessPrincipal extends Record<string, unknown> {
  sub: string;
  id: string;
  userId: string;
  exp: number;
}

/** Signature, purpose and current account state are separate checks. */
export async function verifyAccessToken(
  jwt: JwtService,
  users: Pick<Repository<User>, 'findOne'>,
  token: string,
  sessions: Pick<AuthSessionsService, 'assertActive'>,
): Promise<AccessPrincipal> {
  let payload: Record<string, unknown>;
  try {
    payload = await jwt.verifyAsync(token);
  } catch {
    throw new UnauthorizedException('Invalid access token');
  }
  const userId = typeof payload?.sub === 'string' ? payload.sub.trim() : '';
  const expiresAt = payload?.exp;
  if (!userId || (payload.type !== undefined && payload.type !== 'access') ||
      typeof expiresAt !== 'number' || !Number.isFinite(expiresAt * 1000) || expiresAt * 1000 <= Date.now()) {
    throw new UnauthorizedException('Invalid access token');
  }

  let user: User | null;
  try {
    user = await users.findOne({ where: { id: userId }, select: { id: true, status: true, userRoles: { id: true, role: { code: true } } }, relations: { userRoles: { role: true } } });
  } catch {
    // A database outage is not proof that the credentials have been revoked.
    throw new ServiceUnavailableException('Authentication service unavailable');
  }
  if (!user || user.id !== userId || user.status !== UserStatus.ACTIVE || expiresAt * 1000 <= Date.now()) {
    throw new UnauthorizedException('Invalid access token');
  }
  await sessions.assertActive({ ...payload, sub: userId });
  if (expiresAt * 1000 <= Date.now()) throw new UnauthorizedException('Invalid access token');
  // Permissions come from current roles, never an old signed role snapshot.
  const roles = (user.userRoles ?? []).map(link => link.role.code);
  return { ...payload, sub: userId, id: userId, userId, exp: expiresAt, roles };
}
