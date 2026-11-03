import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';

import { authSessionMemory } from '../../testing/auth-session-memory.test-support';
import { buildAuthSessionOptions } from '../../common/security/auth-session-options';
import { UserRole } from '../users/user-role.entity';
import { User, UserStatus } from '../users/user.entity';

import { AuthSession } from './auth-session.entity';
import { AuthSessionsService } from './auth-sessions.service';
import { AuthService } from './auth.service';
import { PasswordService } from '../../common/security/password.service';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import { EmailService } from '../notifications/email.service';
import { Role } from '../users/role.entity';
import { Shop } from '../shops/shop.entity';
import { KycProfile } from '../users/kyc-profile.entity';
import type { Repository } from 'typeorm';

const key = 'synthetic-session-signing-key-at-least-32bytes';
describe('Durable session rotation and revocation (synthetic transaction model)', () => {
  const jwt = new JwtService({ secret: key, signOptions: { expiresIn: '15m' } });
  const options = buildAuthSessionOptions({ JWT_SECRET: key, JWT_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '1h' });
  let memory: ReturnType<typeof authSessionMemory>;
  let sessions: AuthSessionsService;
  const user = { id: 'synthetic-user', email: 'synthetic@example.invalid', status: UserStatus.ACTIVE, passwordHash: 'synthetic-password-hash', googleId: 'synthetic-google-id' } as User;
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-03T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    memory = authSessionMemory({ user: User, session: AuthSession, role: UserRole }, [user]);
    sessions = new AuthSessionsService(memory.repository, jwt, options);
  });
  afterEach(() => jest.useRealTimers());
  const advance = (seconds: number) => jest.setSystemTime(new Date(Date.now() + seconds * 1000));
  const refresh = (token: string) => sessions.refresh(token).then(result => result.tokens);
  const decoded = (token: string) => jwt.decode(token) as Record<string, unknown>;

  it('creates a bound family, finite access/absolute refresh expiry, and only a hash in storage', async () => {
    const tokens = await sessions.create(user.id, { passwordHash: user.passwordHash! });
    const access = decoded(tokens.accessToken), refresh = decoded(tokens.refreshToken);
    expect(access).toMatchObject({ type: 'access', sub: user.id, sid: refresh.sid, roles: ['customer'] });
    expect((access.exp as number) - (access.iat as number)).toBe(900);
    expect((refresh.exp as number) - (refresh.iat as number)).toBe(3600);
    const stored = [...memory.sessions.values()][0];
    expect(stored.refreshHash).toBe(createHash('sha256').update(refresh.jti as string).digest('hex'));
    expect(JSON.stringify([...memory.sessions.values()])).not.toContain(refresh.jti);
    expect(JSON.stringify([...memory.sessions.values()])).not.toContain(tokens.refreshToken);
    await sessions.assertActive(access);
  });
  it.each([UserStatus.PENDING, UserStatus.SUSPENDED, UserStatus.DELETED])('cannot create a session for current %s account', async status => {
    memory.users.set(user.id, { ...user, status });
    await expect(sessions.create(user.id)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(memory.sessions.size).toBe(0);
  });
  it('rejects a password changed between credential check and locked session creation', async () => {
    memory.users.set(user.id, { ...user, passwordHash: 'changed-password' });
    await expect(sessions.create(user.id, { passwordHash: user.passwordHash! })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(memory.sessions.size).toBe(0);
  });
  it('rejects a changed Google account binding', async () => {
    await expect(sessions.create(user.id, { googleId: 'different-id' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('does not rotate again while a recent credential is within the retry window', async () => {
    const initial = await sessions.create(user.id); advance(10);
    const next = await refresh(initial.refreshToken);
    expect(next.refreshToken).toBe(initial.refreshToken);
    expect([...memory.sessions.values()][0].generation).toBe(0);
  });
  it('rotates after the retry window and converges a lost-response retry on the exact successor', async () => {
    const initial = await sessions.create(user.id); advance(31);
    const next = await refresh(initial.refreshToken); advance(1);
    const retry = await refresh(initial.refreshToken);
    expect(next.refreshToken).not.toBe(initial.refreshToken);
    expect(retry.refreshToken).toBe(next.refreshToken);
    expect([...memory.sessions.values()][0].generation).toBe(1);
    expect(retry.refreshTokenExpiry).toBe(initial.refreshTokenExpiry);
  });
  it('serializes concurrent refreshes without false reuse or multiple successors', async () => {
    const initial = await sessions.create(user.id); advance(31);
    const results = await Promise.all([refresh(initial.refreshToken), refresh(initial.refreshToken), refresh(initial.refreshToken)]);
    expect(new Set(results.map(result => result.refreshToken)).size).toBe(1);
    expect([...memory.sessions.values()][0].generation).toBe(1);
    const rapidCurrent = await refresh(results[0].refreshToken);
    expect(rapidCurrent.refreshToken).toBe(results[0].refreshToken);
  });
  it('commits reuse revocation outside grace, invalidating current access and refresh only in that family', async () => {
    const initial = await sessions.create(user.id); const other = await sessions.create(user.id);
    advance(31); const next = await refresh(initial.refreshToken); advance(31);
    await expect(refresh(initial.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect([...memory.sessions.values()].filter(row => row.revokedAt)).toHaveLength(1);
    await expect(sessions.assertActive(decoded(next.accessToken))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(refresh(next.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await sessions.assertActive(decoded(other.accessToken));
  });
  it('rollback on failed refresh commit preserves the old credential for a safe retry', async () => {
    const initial = await sessions.create(user.id); advance(31); memory.controls.failCommit = true;
    await expect(refresh(initial.refreshToken)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect([...memory.sessions.values()][0].generation).toBe(0);
    const retry = await refresh(initial.refreshToken);
    expect(decoded(retry.refreshToken).generation).toBe(1);
  });
  it('sign-out is idempotent and revokes both access and refresh for that device', async () => {
    const tokens = await sessions.create(user.id);
    await sessions.revoke(tokens.refreshToken); await sessions.revoke(tokens.refreshToken);
    await expect(sessions.assertActive(decoded(tokens.accessToken))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(refresh(tokens.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('allows a signed expired refresh to revoke only its own expired family', async () => {
    const tokens = await sessions.create(user.id); advance(3601);
    await sessions.revoke(tokens.refreshToken);
    expect([...memory.sessions.values()][0].revokedAt).not.toBeNull();
  });
  it('allows access-only local sessions to revoke their own family', async () => {
    const tokens = await sessions.create(user.id);
    await sessions.revoke(tokens.accessToken, 'access');
    await expect(sessions.assertActive(decoded(tokens.accessToken))).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('sign-out-all preserves another account and invalidates every caller session', async () => {
    const one = await sessions.create(user.id), two = await sessions.create(user.id);
    const otherUser = { ...user, id: 'synthetic-other' }; memory.users.set(otherUser.id, otherUser);
    const other = await sessions.create(otherUser.id);
    await sessions.revokeAll(user.id);
    for (const token of [one.accessToken, two.accessToken]) await expect(sessions.assertActive(decoded(token))).rejects.toBeInstanceOf(UnauthorizedException);
    await sessions.assertActive(decoded(other.accessToken));
  });
  it('expired refresh cannot issue a new family or slide its absolute lifetime', async () => {
    const initial = await sessions.create(user.id); advance(3601);
    await expect(refresh(initial.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(memory.sessions.size).toBe(1);
  });
  it('clips access expiry to the remaining absolute session lifetime', async () => {
    const initial = await sessions.create(user.id); advance(3500);
    const next = await refresh(initial.refreshToken);
    expect(next.accessTokenExpiry).toBe(initial.refreshTokenExpiry);
  });
  it('cannot use a valid signed family credential under another account', async () => {
    const initial = await sessions.create(user.id); memory.users.set('other', { ...user, id: 'other' });
    const { exp, ...payload } = decoded(initial.refreshToken);
    const forgedBinding = await jwt.signAsync({ ...payload, sub: 'other' }, { expiresIn: (exp as number) - (payload.iat as number) });
    await expect(refresh(forgedBinding)).rejects.toBeInstanceOf(UnauthorizedException);
    expect([...memory.sessions.values()][0].revokedAt).toBeNull();
  });
  it('does not accept old stateless access after the explicit session cutover', async () => {
    await expect(sessions.assertActive({ sub: user.id, exp: Date.now() / 1000 + 60 })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('session-store outage is unavailable, never proof of credential invalidity', async () => {
    const tokens = await sessions.create(user.id); memory.controls.failReads = true;
    await expect(sessions.assertActive(decoded(tokens.accessToken))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('checks batched session ownership, revocation and expiry without exposing credential hashes', async () => {
    const one = await sessions.create(user.id), two = await sessions.create(user.id);
    await sessions.revoke(one.refreshToken);
    const keys = await sessions.activeKeys([decoded(one.accessToken), decoded(two.accessToken), { ...decoded(two.accessToken), sub: 'wrong' }]);
    expect([...keys]).toEqual([`${decoded(two.accessToken).sid}:${user.id}`]);
    const read = memory.events.filter(event => event.operation === 'find' && event.entity === 'AuthSession').at(-1)!;
    expect((read.options as { select: Record<string, boolean> }).select).not.toHaveProperty('refreshHash');
  });
  it('locks the plain user row before the session row without eager outer joins', async () => {
    const initial = await sessions.create(user.id); advance(31); memory.events.length = 0;
    await refresh(initial.refreshToken);
    const locks = memory.events.filter(event => (event.options as { lock?: unknown })?.lock);
    expect(locks.map(event => event.entity)).toEqual(['User', 'AuthSession']);
    expect(locks[0].options).toMatchObject({ loadEagerRelations: false, lock: { mode: 'pessimistic_write' } });
  });
  function passwordResetService() {
    return new AuthService(memory.manager.getRepository(User), {} as Repository<Role>, {} as Repository<UserRole>, {} as Repository<Shop>, {} as Repository<KycProfile>,
      { compare: async () => true, hash: async () => 'new-password-hash' } as unknown as PasswordService, jwt,
      { sendEmail: async () => ({ status: 'accepted' }) } as unknown as EmailService, sessions, {} as ItemGeocodingService);
  }
  it('password reset atomically consumes the OTP, changes the password and revokes all sessions', async () => {
    const initial = await sessions.create(user.id);
    memory.users.set(user.id, { ...memory.users.get(user.id)!, resetOtpHash: 'synthetic-otp-hash', resetOtpExpiresAt: new Date(Date.now() + 60000) });
    const auth = passwordResetService();
    await auth.resetPassword(user.email, 'synthetic-otp', 'new-password');
    expect(memory.users.get(user.id)).toMatchObject({ passwordHash: 'new-password-hash', resetOtpHash: null, resetOtpExpiresAt: null });
    await expect(sessions.assertActive(decoded(initial.accessToken))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.resetPassword(user.email, 'synthetic-otp', 'another-password')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('failed password-reset commit rolls back both the credential change and session revocation', async () => {
    const initial = await sessions.create(user.id);
    memory.users.set(user.id, { ...memory.users.get(user.id)!, resetOtpHash: 'synthetic-otp-hash', resetOtpExpiresAt: new Date(Date.now() + 60000) });
    memory.controls.failCommit = true;
    await expect(passwordResetService().resetPassword(user.email, 'synthetic-otp', 'new-password')).rejects.toThrow('synthetic commit failure');
    expect(memory.users.get(user.id)?.passwordHash).toBe(user.passwordHash);
    expect(memory.users.get(user.id)?.resetOtpHash).toBe('synthetic-otp-hash');
    await sessions.assertActive(decoded(initial.accessToken));
  });
});
