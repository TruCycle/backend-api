import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response as ExpressResponse } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { Repository } from 'typeorm';

import { PasswordService } from '../../common/security/password.service';
import { EmailService } from '../notifications/email.service';
import { Shop } from '../shops/shop.entity';
import { KycProfile } from '../users/kyc-profile.entity';
import { Role, RoleCode } from '../users/role.entity';
import { UserRole } from '../users/user-role.entity';
import { User, UserStatus } from '../users/user.entity';

import { AuthResetEmailLimiter } from './auth-rate-limit.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSessionsService } from './auth-sessions.service';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import { AuthSession } from './auth-session.entity';
import { authSessionMemory } from '../../testing/auth-session-memory.test-support';

const params = { to: 'synthetic@example.invalid', subject: 'Verification', html: '<p>SYNTHETIC_TOKEN</p>' };

describe('Activation email outcomes without provider access', () => {
  let original: NodeJS.ProcessEnv;
  beforeEach(() => {
    original = { ...process.env }; delete process.env.BREVO_API_KEY; delete process.env.RESEND_API_KEY;
    for (const level of ['warn', 'error', 'log'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  });
  afterEach(() => { process.env = original; jest.restoreAllMocks(); jest.useRealTimers(); });
  it('reports unavailable without sending when no provider exists', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    expect(await new EmailService().sendEmail(params)).toEqual({ status: 'unavailable' }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['brevo', 'resend'] as const)('reports %s acceptance without claiming inbox delivery', async (provider) => {
    process.env[provider === 'brevo' ? 'BREVO_API_KEY' : 'RESEND_API_KEY'] = 'SYNTHETIC_ONLY';
    const text = jest.fn(); jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 202, text } as unknown as Response);
    expect(await new EmailService().sendEmail(params)).toEqual({ status: 'accepted' }); expect(text).not.toHaveBeenCalled();
  });
  it('reports rejection, prefers Brevo and does not retry another provider', async () => {
    process.env.BREVO_API_KEY = 'SYNTHETIC_ONLY'; process.env.RESEND_API_KEY = 'SYNTHETIC_ONLY';
    const text = jest.fn().mockResolvedValue('PRIVATE_TOKEN PRIVATE_EMAIL');
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, text } as unknown as Response);
    expect(await new EmailService().sendEmail(params)).toEqual({ status: 'rejected' }); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.brevo.com/v3/smtp/email'); expect(text).not.toHaveBeenCalled();
  });
  it('reports network failure without exception contents', async () => {
    process.env.RESEND_API_KEY = 'SYNTHETIC_ONLY'; jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('PRIVATE_URL PRIVATE_TOKEN'));
    expect(await new EmailService().sendEmail(params)).toEqual({ status: 'failed' });
  });
  it('bounds a hung provider at ten seconds and aborts without fallback', async () => {
    jest.useFakeTimers(); process.env.BREVO_API_KEY = 'SYNTHETIC_ONLY';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => undefined));
    const result = new EmailService().sendEmail(params); await jest.advanceTimersByTimeAsync(10000);
    expect(await result).toEqual({ status: 'timeout' }); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});

describe('Activation recovery with synthetic repositories only', () => {
  let original: NodeJS.ProcessEnv;
  const user = { id: 'synthetic-user', email: 'synthetic@example.invalid', status: UserStatus.PENDING, createdAt: new Date(0) };
  const users = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn() };
  const roles = { findOne: jest.fn() }; const links = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
  const jwt = { signAsync: jest.fn(), verifyAsync: jest.fn(), decode: jest.fn() }; const sendEmail = jest.fn();
  let service: AuthService;
  const sessions = { create: jest.fn().mockResolvedValue({ accessToken: 'ACCESS_SYNTHETIC', refreshToken: 'REFRESH_SYNTHETIC' }) };
  beforeEach(() => {
    original = { ...process.env }; delete process.env.FRONTEND_BASE_URL; delete process.env.AUTH_RESET_EMAIL_LIMITS; jest.resetAllMocks();
    users.findOne.mockResolvedValue({ ...user }); users.create.mockImplementation((value) => value); users.save.mockImplementation(async (value) => ({ ...value, id: user.id }));
    roles.findOne.mockResolvedValue({ id: 'role', code: RoleCode.CUSTOMER }); links.find.mockResolvedValue([{ role: { code: RoleCode.CUSTOMER } }]); links.create.mockImplementation((value) => value);
    const manager = { queryRunner: { isTransactionActive: true }, getRepository: (entity: unknown) => entity === User ? users : links };
    Object.assign(users, { manager: { transaction: (work: (tx: EntityManager) => Promise<unknown>) => work(manager as unknown as EntityManager) } });
    sessions.create.mockResolvedValue({ accessToken: 'ACCESS_SYNTHETIC', refreshToken: 'REFRESH_SYNTHETIC' });
    jwt.signAsync.mockResolvedValue('SYNTHETIC_TOKEN'); jwt.decode.mockReturnValue({ exp: 2000000000 }); jwt.verifyAsync.mockResolvedValue({ sub: user.id, email: user.email, type: 'verify', exp: Math.floor(Date.now() / 1000) + 3600 });
    sendEmail.mockResolvedValue({ status: 'accepted' });
    service = new AuthService(users as unknown as Repository<User>, roles as unknown as Repository<Role>, links as unknown as Repository<UserRole>, {} as Repository<Shop>, {} as Repository<KycProfile>, { hash: jest.fn().mockResolvedValue('synthetic-hash') } as unknown as PasswordService, jwt as unknown as JwtService, { sendEmail } as unknown as EmailService, sessions as unknown as AuthSessionsService, {} as ItemGeocodingService);
  });
  afterEach(() => { process.env = original; jest.restoreAllMocks(); });
  function configureResetEmailLimits() {
    process.env.AUTH_RATE_LIMITS = JSON.stringify({ register: 100, login: 100, google: 100, resend: 100, reset_request: 100, reset_attempt: 100 });
    process.env.AUTH_RESET_EMAIL_LIMITS = JSON.stringify({ reset_request: 2, reset_attempt: 3 });
    process.env.AUTH_RESET_EMAIL_LIMIT_KEY = Buffer.alloc(32, 1).toString('hex');
    process.env.DB_LOGGING = 'false';
  }

  it('does not call the scoped counter while it is disabled', async () => {
    const query = jest.fn();
    await new AuthResetEmailLimiter({ query } as unknown as DataSource).consume('reset_request', user.email, {} as ExpressResponse);
    expect(query).not.toHaveBeenCalled();
  });

  it('normalizes reset targets and sends separate binary digests for operations to the database', async () => {
    configureResetEmailLimits();
    const query = jest.fn().mockResolvedValue([{ allowed: true, retry_after: 20 }]);
    const limiter = new AuthResetEmailLimiter({ query } as unknown as DataSource);
    const response = {} as ExpressResponse;
    await limiter.consume('reset_request', `  ${user.email.toUpperCase()}  `, response);
    await limiter.consume('reset_request', user.email, response);
    await limiter.consume('reset_attempt', user.email, response);
    const [first, repeated, attempt] = query.mock.calls.map(([, parameters]) => parameters);
    expect(first).toEqual(['reset_request', expect.any(Buffer), 2]);
    expect(first[1]).toHaveLength(32);
    expect(first).toEqual(repeated);
    expect(attempt).toEqual(['reset_attempt', expect.any(Buffer), 3]);
    expect(attempt[1]).not.toEqual(first[1]);
  });

  it('requires global budgets, a digest key and query logging off before enabling scoped budgets', () => {
    configureResetEmailLimits();
    delete process.env.AUTH_RATE_LIMITS;
    expect(() => new AuthResetEmailLimiter()).toThrow('requires AUTH_RATE_LIMITS');
    configureResetEmailLimits();
    process.env.DB_LOGGING = 'true';
    expect(() => new AuthResetEmailLimiter()).toThrow('requires DB_LOGGING=false');
    configureResetEmailLimits();
    delete process.env.AUTH_RESET_EMAIL_LIMIT_KEY;
    expect(() => new AuthResetEmailLimiter()).toThrow('AUTH_RESET_EMAIL_LIMIT_KEY');
  });

  it('rejects over-budget reset operations before querying account state', async () => {
    configureResetEmailLimits();
    process.env.APP_RELEASE_SHA = 'a'.repeat(40);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const query = jest.fn().mockResolvedValue([{ allowed: false, retry_after: 20 }]);
    const limitedController = new AuthController(service, new AuthResetEmailLimiter({ query } as unknown as DataSource));
    const setHeader = jest.fn();
    const response = { setHeader } as unknown as ExpressResponse;
    await expect(limitedController.forgetPassword({ email: user.email }, response)).rejects.toMatchObject({ status: 429 });
    await expect(limitedController.forgetPassword({ email: 'another@example.invalid' }, response)).rejects.toMatchObject({ status: 429 });
    await expect(limitedController.resetPassword({ email: user.email, otp: '000000', new_password: 'synthetic-only' }, response))
      .rejects.toMatchObject({ status: 429 });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '20');
    expect(users.findOne).not.toHaveBeenCalled();
    expect(warn.mock.calls.map(([message]) => [JSON.parse(message)])).toEqual([
      [{ event: 'auth_rate_limit', scope: 'reset_email', operation: 'reset_request', outcome: 'limited', release: 'a'.repeat(40) }],
      [{ event: 'auth_rate_limit', scope: 'reset_email', operation: 'reset_attempt', outcome: 'limited', release: 'a'.repeat(40) }],
    ]);
  });

  it('attributes hosted budget events to the Railway release without exposing identity', async () => {
    configureResetEmailLimits();
    delete process.env.APP_RELEASE_SHA;
    process.env.RAILWAY_GIT_COMMIT_SHA = 'b'.repeat(40);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    const query = jest.fn().mockResolvedValue([{ allowed: false, retry_after: 15 }]);
    const limiter = new AuthResetEmailLimiter({ query } as unknown as DataSource);
    const response = { setHeader: jest.fn() } as unknown as ExpressResponse;
    await expect(limiter.consume('reset_request', 'PRIVATE_SYNTHETIC_EMAIL@example.invalid', response))
      .rejects.toMatchObject({ status: 429 });
    expect(warn.mock.calls.every(([message]) => typeof message === 'string' && !message.includes('\n'))).toBe(true);
    expect(warn.mock.calls.map(([message]) => [JSON.parse(message)])).toEqual([
      [{ event: 'auth_rate_limit', scope: 'reset_email', operation: 'reset_request', outcome: 'limited', release: 'b'.repeat(40) }],
    ]);
  });

  it('fails closed without exposing counter-store diagnostics', async () => {
    configureResetEmailLimits();
    process.env.APP_RELEASE_SHA = 'PRIVATE_INVALID_RELEASE';
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const query = jest.fn().mockRejectedValue(new Error('PRIVATE_COUNTER_DIAGNOSTIC'));
    const limiter = new AuthResetEmailLimiter({ query } as unknown as DataSource);
    await expect(limiter.consume('reset_attempt', user.email, {} as ExpressResponse)).rejects.toMatchObject({
      status: 503,
      message: 'Authentication is temporarily unavailable',
    });
    expect(warn.mock.calls.map(([message]) => [JSON.parse(message)])).toEqual([
      [{ event: 'auth_rate_limit', scope: 'reset_email', operation: 'reset_attempt', outcome: 'unavailable' }],
    ]);
  });

  it('does not issue a code if the account changes email before the issuance lock', async () => {
    users.findOne.mockResolvedValueOnce({ ...user, status: UserStatus.ACTIVE });
    users.findOne.mockResolvedValueOnce({ ...user, email: 'changed@example.invalid', status: UserStatus.ACTIVE });
    await service.requestPasswordReset(user.email);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });
  it('issues only the reset fields under lock and sends to the rechecked address', async () => {
    users.findOne.mockResolvedValue({ ...user, status: UserStatus.ACTIVE });
    await service.requestPasswordReset(user.email.toUpperCase());
    expect(users.findOne).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: user.id }, lock: { mode: 'pessimistic_write' } }));
    expect(users.update).toHaveBeenCalledWith(user.id, { resetOtpHash: 'synthetic-hash', resetOtpExpiresAt: expect.any(Date) });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: user.email }));
    expect(users.update.mock.invocationCallOrder[0]).toBeLessThan(sendEmail.mock.invocationCallOrder[0]);
  });
  it('an expired code fails without writing a stale user snapshot', async () => {
    users.findOne.mockResolvedValueOnce({ ...user, resetOtpHash: 'old-hash', resetOtpExpiresAt: new Date(0) });
    await expect(service.resetPassword(user.email, '000000', 'new-password')).rejects.toThrow('Invalid or expired OTP');
    expect(users.save).not.toHaveBeenCalled();
  });
  it('uses canonical frontend URL rather than API base and retains 24h expiry', async () => {
    process.env.APP_BASE_URL = 'https://api.example.invalid'; await service.resendVerification(user.email);
    expect(sendEmail.mock.calls[0][0].html).toContain('https://trucycle.co.uk/auth/verify-email?token=SYNTHETIC_TOKEN');
    expect(sendEmail.mock.calls[0][0].html).not.toContain('https://api.example.invalid/auth/');
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: user.id, email: user.email, type: 'verify' }, { expiresIn: '24h' });
  });
  it('supports explicitly configured isolated frontend origin', async () => {
    process.env.FRONTEND_BASE_URL = 'http://localhost:4201/ignored/path'; await service.resendVerification(user.email);
    expect(sendEmail.mock.calls[0][0].html).toContain('http://localhost:4201/auth/verify-email?token=');
  });
  it.each(['not-a-url', 'javascript:alert(1)', 'http://public.example.invalid'])('contains invalid frontend config %s without revealing eligibility', async (value) => {
    process.env.FRONTEND_BASE_URL = value; const controller = new AuthController(service, new AuthResetEmailLimiter());
    const pending = await controller.resendVerification({ email: user.email }); users.findOne.mockResolvedValue(null);
    expect(await controller.resendVerification({ email: user.email })).toEqual(pending); expect(sendEmail).not.toHaveBeenCalled();
  });
  it.each(['accepted', 'unavailable', 'rejected', 'timeout', 'failed'])('keeps %s resend response identical for pending, absent and active', async (status) => {
    sendEmail.mockResolvedValue({ status }); const controller = new AuthController(service, new AuthResetEmailLimiter());
    const pending = await controller.resendVerification({ email: user.email });
    users.findOne.mockResolvedValue({ ...user, status: UserStatus.ACTIVE }); expect(await controller.resendVerification({ email: user.email })).toEqual(pending);
    users.findOne.mockResolvedValue(null); expect(await controller.resendVerification({ email: user.email })).toEqual(pending);
    expect(pending.message).not.toMatch(/sent successfully|delivered/i); expect(sendEmail).toHaveBeenCalledTimes(1);
  });
  it('permits repeated resend and normalizes address', async () => {
    await service.resendVerification('  SYNTHETIC@example.invalid  '); await service.resendVerification(user.email);
    expect(users.findOne).toHaveBeenCalledWith({ where: { email: user.email } }); expect(sendEmail).toHaveBeenCalledTimes(2);
  });
  it('contains signing failure in generic resend response', async () => {
    jwt.signAsync.mockRejectedValue(new Error('PRIVATE_TOKEN'));
    expect(await new AuthController(service, new AuthResetEmailLimiter()).resendVerification({ email: user.email })).toEqual({ status: 'success', message: 'If an account needs verification, a verification email has been requested.', data: null });
  });
  it('returns account with sanitized delivery failure without undoing registration', async () => {
    users.findOne.mockImplementation(async ({ where }: { where: { email?: string; id?: string } }) => where.email ? null : { ...user }); sendEmail.mockResolvedValue({ status: 'rejected' });
    const result = await new AuthController(service, new AuthResetEmailLimiter()).register({ email: user.email, password: 'synthetic-only', first_name: 'Synthetic', last_name: 'User' });
    expect(result.data.verificationDelivery).toEqual({ status: 'rejected' }); expect(result.data.user.status).toBe(UserStatus.PENDING); expect(JSON.stringify(result)).not.toContain('SYNTHETIC_TOKEN');
  });
  it('activates pending once and makes still-valid repeated links idempotent', async () => {
    const pending = { ...user }; users.findOne.mockResolvedValue(pending); await service.verifyUser('synthetic'); await service.verifyUser('synthetic');
    expect(users.save).toHaveBeenCalledTimes(1); expect(pending.status).toBe(UserStatus.ACTIVE);
    expect(sessions.create).not.toHaveBeenCalled();
    expect(await new AuthController(service, new AuthResetEmailLimiter()).verify({ token: 'synthetic' })).toEqual({ status: 'success', message: 'Email verified. Sign in to continue.', data: { verified: true } });
    expect(users.findOne).toHaveBeenCalledWith({ where: { id: user.id }, loadEagerRelations: false, lock: { mode: 'pessimistic_write' } });
  });
  it.each([undefined, '', 'other@example.invalid', 1])('rejects absent or mismatched verification email %s without activation', async email => {
    jwt.verifyAsync.mockResolvedValue({ sub: user.id, email, type: 'verify', exp: Math.floor(Date.now() / 1000) + 3600 });
    await expect(service.verifyUser('synthetic')).rejects.toThrow('Invalid or expired token');
    expect(users.save).not.toHaveBeenCalled(); expect(sessions.create).not.toHaveBeenCalled();
  });
  function transactionalActivation() {
    const memory = authSessionMemory({ user: User, session: AuthSession, role: UserRole }, [{ ...user } as User]);
    const subject = new AuthService(memory.manager.getRepository(User), roles as unknown as Repository<Role>, links as unknown as Repository<UserRole>, {} as Repository<Shop>, {} as Repository<KycProfile>, {} as PasswordService, jwt as unknown as JwtService, { sendEmail } as unknown as EmailService, sessions as unknown as AuthSessionsService, {} as ItemGeocodingService);
    return { memory, subject };
  }
  it('concurrent verification activates once without minting login credentials', async () => {
    const { memory, subject } = transactionalActivation();
    expect(await Promise.all([subject.verifyUser('synthetic'), subject.verifyUser('synthetic')])).toEqual([{ verified: true }, { verified: true }]);
    expect(memory.users.get(user.id)?.status).toBe(UserStatus.ACTIVE);
    expect(memory.events.filter(event => event.entity === 'User' && event.operation === 'save')).toHaveLength(1);
    expect(memory.sessions.size).toBe(0); expect(sessions.create).not.toHaveBeenCalled();
  });
  it('failed activation commit stays pending and a retry safely completes', async () => {
    const { memory, subject } = transactionalActivation(); memory.controls.failCommit = true;
    await expect(subject.verifyUser('synthetic')).rejects.toThrow();
    expect(memory.users.get(user.id)?.status).toBe(UserStatus.PENDING);
    expect(await subject.verifyUser('synthetic')).toEqual({ verified: true });
    expect(memory.users.get(user.id)?.status).toBe(UserStatus.ACTIVE); expect(sessions.create).not.toHaveBeenCalled();
  });
  it('rechecks expiry after waiting for the account lock', async () => {
    jest.useFakeTimers();
    try {
      const start = Date.now();
      jwt.verifyAsync.mockResolvedValue({ sub: user.id, email: user.email, type: 'verify', exp: Math.floor(start / 1000) + 1 });
      users.findOne.mockImplementation(async () => { jest.setSystemTime(start + 2000); return { ...user }; });
      await expect(service.verifyUser('synthetic')).rejects.toThrow('Invalid or expired token');
      expect(users.save).not.toHaveBeenCalled(); expect(sessions.create).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });
  it.each(['refresh', undefined])('rejects wrong token type %s', async (type) => {
    jwt.verifyAsync.mockResolvedValue({ sub: user.id, type }); await expect(service.verifyUser('synthetic')).rejects.toThrow('Invalid or expired token'); expect(users.save).not.toHaveBeenCalled();
  });
  it('rejects expired and invalid tokens generically', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('Expired PRIVATE_TOKEN')); await expect(service.verifyUser('synthetic')).rejects.toThrow('Invalid or expired token'); expect(users.save).not.toHaveBeenCalled();
  });
  it.each([UserStatus.DELETED, UserStatus.SUSPENDED])('never reactivates %s', async (status) => {
    users.findOne.mockResolvedValue({ ...user, status }); await expect(service.verifyUser('synthetic')).rejects.toThrow('Account not eligible'); expect(users.save).not.toHaveBeenCalled();
  });
});
