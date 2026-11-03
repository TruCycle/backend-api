import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { EntityManager, In, IsNull, MoreThan, Repository } from 'typeorm';

import { AUTH_SESSION_OPTIONS, AuthSessionOptions } from '../../common/security/auth-session-options';
import { UserRole } from '../users/user-role.entity';
import { User, UserStatus } from '../users/user.entity';

import { AuthSession } from './auth-session.entity';

export interface SessionTokens {
  accessToken: string; refreshToken: string;
  accessTokenExpiry: string; refreshTokenExpiry: string;
}
interface SessionClaims extends Record<string, unknown> { sub: string; sid: string; exp: number }
interface RefreshClaims extends SessionClaims { jti: string; generation: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function sameHash(left: string | null, right: string): boolean {
  return typeof left === 'string' && /^[a-f0-9]{64}$/.test(left) && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

@Injectable()
export class AuthSessionsService {
  constructor(
    @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>,
    private readonly jwt: JwtService,
    @Inject(AUTH_SESSION_OPTIONS) private readonly options: AuthSessionOptions,
  ) {}

  async create(userId: string, proof: { passwordHash?: string; googleId?: string } = {}): Promise<SessionTokens> {
    return this.transaction(async manager => {
      const user = await this.lockUser(manager, userId);
      if (!user || user.status !== UserStatus.ACTIVE ||
          (proof.passwordHash !== undefined && proof.passwordHash !== user.passwordHash) ||
          (proof.googleId !== undefined && proof.googleId !== user.googleId)) this.invalid();
      const now = new Date(); const nonce = randomBytes(32).toString('hex');
      const repo = manager.getRepository(AuthSession);
      const session = repo.create({ id: randomUUID(), userId, refreshHash: digest(nonce), previousRefreshHash: null,
        generation: 0, refreshIssuedAt: now, previousValidUntil: null,
        expiresAt: new Date(now.getTime() + this.options.refreshSeconds * 1000), revokedAt: null, createdAt: now, lastUsedAt: now });
      await repo.save(session);
      return this.tokens(manager, user!, session, nonce);
    });
  }

  async refresh(token: string): Promise<{ userId: string; tokens: SessionTokens }> {
    const claims = await this.refreshClaims(token);
    const result = await this.transaction(async manager => {
      const user = await this.lockUser(manager, claims.sub);
      if (!user || user.status !== UserStatus.ACTIVE) return null;
      const repo = manager.getRepository(AuthSession);
      const session = await repo.findOne({ where: { id: claims.sid, userId: claims.sub }, lock: { mode: 'pessimistic_write' },
        select: { id: true, userId: true, refreshHash: true, previousRefreshHash: true, generation: true, refreshIssuedAt: true,
          previousValidUntil: true, expiresAt: true, revokedAt: true, createdAt: true, lastUsedAt: true } });
      if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || claims.exp * 1000 <= Date.now()) return null;
      const presentedHash = digest(claims.jti);
      let nonce: string;
      if (claims.generation === session.generation && sameHash(session.refreshHash, presentedHash)) {
        nonce = claims.jti;
        // Suppress rapid B->C rotation while A->B responses may still be in flight.
        // This makes normal concurrent/retried refreshes converge on the same B.
        if (Date.now() - session.refreshIssuedAt.getTime() >= this.options.retryGraceSeconds * 1000) {
          session.previousRefreshHash = session.refreshHash;
          session.previousValidUntil = new Date(Date.now() + this.options.retryGraceSeconds * 1000);
          session.generation++;
          nonce = this.nextNonce(session.id, session.generation, claims.jti);
          session.refreshHash = digest(nonce);
          session.refreshIssuedAt = new Date();
        }
      } else if (claims.generation === session.generation - 1 && sameHash(session.previousRefreshHash, presentedHash) &&
                 session.previousValidUntil && session.previousValidUntil.getTime() > Date.now()) {
        nonce = this.nextNonce(session.id, session.generation, claims.jti);
        if (!sameHash(session.refreshHash, digest(nonce))) throw new ServiceUnavailableException('Authentication service unavailable');
      } else {
        // Commit family revocation before returning an invalid-credential error.
        session.revokedAt = new Date(); await repo.save(session); return null;
      }
      session.lastUsedAt = new Date(); await repo.save(session);
      return this.tokens(manager, user, session, nonce);
    });
    if (!result) this.invalid();
    return { userId: claims.sub, tokens: result! };
  }

  async revoke(token: string, purpose: 'refresh' | 'access' = 'refresh'): Promise<void> {
    const claims = purpose === 'refresh' ? await this.refreshClaims(token, true) : await this.revocationAccessClaims(token);
    await this.transaction(async manager => {
      if (!await this.lockUser(manager, claims.sub)) return;
      await manager.getRepository(AuthSession).update({ id: claims.sid, userId: claims.sub, revokedAt: IsNull() }, { revokedAt: new Date() });
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.transaction(async manager => {
      if (!await this.lockUser(manager, userId)) return;
      await this.revokeAllInTransaction(manager, userId);
    });
  }

  async revokeAllInTransaction(manager: EntityManager, userId: string): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) throw new Error('Session revocation requires an active transaction and a locked user');
    await manager.getRepository(AuthSession).update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async assertActive(principal: Record<string, unknown>): Promise<void> {
    const sid = typeof principal.sid === 'string' ? principal.sid : '';
    const sub = typeof principal.sub === 'string' ? principal.sub : '';
    if (!uuid.test(sid) || !sub) this.invalid();
    let row: AuthSession | null;
    try {
      row = await this.sessions.findOne({ where: { id: sid, userId: sub, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
        select: { id: true, userId: true, expiresAt: true, revokedAt: true }, loadEagerRelations: false });
    } catch { throw new ServiceUnavailableException('Authentication service unavailable'); }
    if (!row || row.id !== sid || row.userId !== sub || row.revokedAt || row.expiresAt.getTime() <= Date.now() || typeof principal.exp !== 'number' ||
        principal.exp * 1000 > row.expiresAt.getTime() || principal.exp * 1000 <= Date.now()) this.invalid();
  }

  async activeKeys(principals: Array<Record<string, unknown>>): Promise<Set<string>> {
    const valid = principals.filter(principal => typeof principal.sid === 'string' && uuid.test(principal.sid) && typeof principal.sub === 'string');
    if (!valid.length) return new Set();
    let rows: AuthSession[];
    try {
      rows = await this.sessions.find({ where: { id: In(valid.map(principal => principal.sid as string)), revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
        select: { id: true, userId: true, expiresAt: true, revokedAt: true }, loadEagerRelations: false });
    } catch { throw new ServiceUnavailableException('Authentication service unavailable'); }
    const byId = new Map(rows.map(row => [row.id, row]));
    return new Set(valid.filter(principal => {
      const row = byId.get(principal.sid as string);
      return row && row.userId === principal.sub && !row.revokedAt && row.expiresAt.getTime() > Date.now() &&
        typeof principal.exp === 'number' && principal.exp * 1000 <= row.expiresAt.getTime() && principal.exp * 1000 > Date.now();
    }).map(principal => `${principal.sid}:${principal.sub}`));
  }

  private async refreshClaims(token: string, allowExpired = false): Promise<RefreshClaims> {
    let claims: Record<string, unknown>;
    try { claims = await this.jwt.verifyAsync(token?.trim(), { ignoreExpiration: allowExpired }); } catch { return this.invalid(); }
    if (claims.type !== 'refresh' || typeof claims.sub !== 'string' || !claims.sub || typeof claims.sid !== 'string' || !uuid.test(claims.sid) ||
        typeof claims.jti !== 'string' || !/^[a-f0-9]{64}$/.test(claims.jti) || !Number.isSafeInteger(claims.generation) || (claims.generation as number) < 0 ||
        typeof claims.exp !== 'number' || !Number.isFinite(claims.exp * 1000) || (!allowExpired && claims.exp * 1000 <= Date.now())) this.invalid();
    return claims as RefreshClaims;
  }

  private async revocationAccessClaims(token: string): Promise<SessionClaims> {
    let claims: Record<string, unknown>;
    try { claims = await this.jwt.verifyAsync(token?.trim(), { ignoreExpiration: true }); } catch { return this.invalid(); }
    if ((claims.type !== 'access' && claims.type !== undefined) || typeof claims.sub !== 'string' || !claims.sub ||
        typeof claims.sid !== 'string' || !uuid.test(claims.sid) || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp * 1000)) this.invalid();
    return claims as SessionClaims;
  }

  private async tokens(manager: EntityManager, user: User, session: AuthSession, nonce: string): Promise<SessionTokens> {
    const links = await manager.getRepository(UserRole).find({ where: { user: { id: user.id } }, relations: { role: true } });
    const now = Math.floor(Date.now() / 1000); const sessionExpiry = Math.floor(session.expiresAt.getTime() / 1000);
    const accessExpiry = Math.min(now + this.options.accessSeconds, sessionExpiry);
    if (accessExpiry <= now) this.invalid();
    const accessToken = await this.jwt.signAsync({ type: 'access', sub: user.id, sid: session.id, email: user.email,
      roles: links.map(link => link.role.code), iat: now }, { expiresIn: accessExpiry - now });
    const refreshIssuedAt = Math.floor(session.refreshIssuedAt.getTime() / 1000);
    const refreshToken = await this.jwt.signAsync({ type: 'refresh', sub: user.id, sid: session.id, jti: nonce,
      generation: session.generation, iat: refreshIssuedAt }, { expiresIn: sessionExpiry - refreshIssuedAt });
    return { accessToken, refreshToken, accessTokenExpiry: new Date(accessExpiry * 1000).toISOString(), refreshTokenExpiry: new Date(sessionExpiry * 1000).toISOString() };
  }

  private nextNonce(id: string, generation: number, previous: string): string {
    return createHmac('sha256', this.options.rotationKey).update(`${id}:${generation}:${previous}`).digest('hex');
  }

  private lockUser(manager: EntityManager, id: string): Promise<User | null> {
    return manager.getRepository(User).findOne({ where: { id }, loadEagerRelations: false, lock: { mode: 'pessimistic_write' } });
  }

  private invalid(): never { throw new UnauthorizedException('Invalid or expired session'); }
  private async transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try { return await this.sessions.manager.transaction(work); }
    catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Authentication service unavailable');
    }
  }
}
