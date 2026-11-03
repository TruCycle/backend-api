import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PasswordService } from '../../common/security/password.service';
import { EmailService } from '../notifications/email.service';
import { Role, RoleCode } from '../users/role.entity';
import { UserRole } from '../users/user-role.entity';
import { User, UserStatus } from '../users/user.entity';
import { Shop } from '../shops/shop.entity';
import { KycProfile } from '../users/kyc-profile.entity';

import { AuthService } from './auth.service';
import { AuthSessionsService } from './auth-sessions.service';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import type { EntityManager } from 'typeorm';

function repoMock() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
}

describe('AuthService', () => {
  let service: AuthService;
  const userRepo = repoMock();
  const roleRepo = repoMock();
  const userRoleRepo = repoMock();
  const shopRepo = repoMock();
  const kycRepo = repoMock();
  const password = new PasswordService();
  const sessions = { create: jest.fn(), refresh: jest.fn(), revoke: jest.fn(), revokeAll: jest.fn(), revokeAllInTransaction: jest.fn() };
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('jwt-token'),
    verifyAsync: jest.fn(),
    decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  } as unknown as JwtService;

  beforeEach(async () => {
    jest.resetAllMocks();
    sessions.create.mockResolvedValue({ accessToken: 'jwt-token', refreshToken: 'jwt-token' });
    const repositories = new Map<unknown, unknown>([[User, userRepo], [Role, roleRepo], [UserRole, userRoleRepo], [Shop, shopRepo], [KycProfile, kycRepo]]);
    const manager = { queryRunner: { isTransactionActive: true }, getRepository: (entity: unknown) => repositories.get(entity) };
    Object.assign(userRepo, { manager: { transaction: (work: (tx: EntityManager) => Promise<unknown>) => work(manager as unknown as EntityManager) } });
    (jwt.signAsync as jest.Mock).mockResolvedValue('jwt-token');
    (jwt.decode as jest.Mock).mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordService,
        { provide: JwtService, useValue: jwt },
        { provide: EmailService, useValue: { sendEmail: jest.fn().mockResolvedValue(undefined) } },
        { provide: AuthSessionsService, useValue: sessions },
        { provide: ItemGeocodingService, useValue: { forwardGeocode: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Role), useValue: roleRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
        { provide: getRepositoryToken(Shop), useValue: shopRepo },
        { provide: getRepositoryToken(KycProfile), useValue: kycRepo },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('registers a pending user without granting an access credential', async () => {
    userRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.email) return undefined; // no existing
      if (where?.id) return { id: 'u1', email: 'a@b.com', status: UserStatus.ACTIVE, createdAt: new Date() };
      return undefined;
    });
    userRepo.create.mockImplementation((x: any) => x);
    userRepo.save.mockImplementation(async (x: any) => ({ ...x, id: 'u1', createdAt: new Date() }));
    roleRepo.findOne.mockResolvedValue({ id: 'r1', code: RoleCode.CUSTOMER });
    userRoleRepo.create.mockImplementation((x: any) => x);
    userRoleRepo.save.mockResolvedValue({ id: 'ur1' });
    userRoleRepo.find = jest.fn().mockResolvedValue([{ role: { code: RoleCode.CUSTOMER } }]);

    const res = await service.register('a@b.com', 'Password123!', undefined);
    expect(res.user.email).toBe('a@b.com');
    expect(res).not.toHaveProperty('token');
    expect(sessions.create).not.toHaveBeenCalled();
    expect(userRepo.create).toHaveBeenCalledWith(expect.objectContaining({ status: UserStatus.PENDING }));
  });

  it('fails to register duplicate email and suggests upgrade', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'exists' });
    await expect(service.register('a@b.com', 'Password123!')).rejects.toThrow('Email already registered');
  });
  it('recovers the winning role after a concurrent role-code insert without retrying a write', async () => {
    const winner = { id: 'winning-role', code: RoleCode.CUSTOMER };
    userRepo.findOne.mockImplementation(async ({ where }: { where: { email?: string } }) => where.email ? null : { id: 'u1', email: 'a@b.com', status: UserStatus.PENDING, createdAt: new Date() });
    userRepo.create.mockImplementation(value => value); userRepo.save.mockImplementation(async value => ({ ...value, id: 'u1' }));
    userRoleRepo.create.mockImplementation(value => value); userRoleRepo.find.mockResolvedValue([{ role: winner }]);
    roleRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    roleRepo.create.mockImplementation(value => value); roleRepo.save.mockRejectedValue({ code: '23505' });
    await service.register('a@b.com', 'Password123!');
    expect(roleRepo.save).toHaveBeenCalledTimes(1);
    expect(userRoleRepo.create).toHaveBeenCalledWith(expect.objectContaining({ role: winner }));
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });
  it.each(['23505', '08006'])('does not continue account creation when role race recovery fails (%s)', async code => {
    userRepo.findOne.mockResolvedValue(null); roleRepo.findOne.mockResolvedValue(null);
    roleRepo.create.mockImplementation(value => value); roleRepo.save.mockRejectedValue({ code });
    await expect(service.register('a@b.com', 'Password123!')).rejects.toEqual({ code });
    expect(userRepo.save).not.toHaveBeenCalled(); expect(userRoleRepo.save).not.toHaveBeenCalled();
    expect(roleRepo.findOne).toHaveBeenCalledTimes(code === '23505' ? 2 : 1);
  });
  it.each([RoleCode.ADMIN, RoleCode.FINANCE, RoleCode.FACILITY])('rejects privileged %s self-registration before any account write', async role => {
    await expect(service.register('a@b.com', 'Password123!', role)).rejects.toThrow('cannot be requested');
    expect(userRepo.save).not.toHaveBeenCalled(); expect(userRoleRepo.save).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('logs in a user successfully', async () => {
    // set a known hash for Password123!
    const hash = await password.hash('Password123!');
    userRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.email) return { id: 'u1', email: 'a@b.com', passwordHash: hash, status: UserStatus.ACTIVE };
      if (where?.id) return { id: 'u1', email: 'a@b.com', status: UserStatus.ACTIVE, createdAt: new Date() };
      return undefined;
    });
    userRoleRepo.find = jest.fn().mockResolvedValue([{ role: { code: RoleCode.CUSTOMER } }]);
    const res = await service.login('a@b.com', 'Password123!');
    expect(res.tokens.accessToken).toBe('jwt-token');
    expect(res.tokens.refreshToken).toBe('jwt-token');
  });

  it('rejects invalid credentials', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash: 'nope', status: UserStatus.ACTIVE });
    await expect(service.login('a@b.com', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('creates a customer account on first Google sign-in', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    jest.spyOn<any, any>(service as any, 'getGoogleClient').mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        getPayload: () => ({
          sub: 'google-123',
          email: 'new@example.com',
          email_verified: true,
          given_name: 'New',
          family_name: 'User',
        }),
      }),
    });
    userRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.id) return { id: 'g1', email: 'new@example.com', status: UserStatus.ACTIVE, createdAt: new Date() };
      return null;
    });
    userRepo.create.mockImplementation((x: any) => x);
    userRepo.save.mockImplementation(async (x: any) => ({ ...x, id: 'g1', createdAt: new Date() }));
    roleRepo.findOne.mockResolvedValue({ id: 'r1', code: RoleCode.CUSTOMER });
    userRoleRepo.create.mockImplementation((x: any) => x);
    userRoleRepo.save.mockResolvedValue({ id: 'ur1' });
    userRoleRepo.find = jest.fn().mockResolvedValue([{ role: { code: RoleCode.CUSTOMER } }]);

    const res = await service.loginWithGoogle('a-valid-looking-google-id-token');
    expect(res.user.email).toBe('new@example.com');
    expect(res.tokens.accessToken).toBe('jwt-token');
    expect(userRepo.save).toHaveBeenCalled();
  });

  it('links Google to an existing email account', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    jest.spyOn<any, any>(service as any, 'getGoogleClient').mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        getPayload: () => ({ sub: 'google-999', email: 'existing@example.com', email_verified: true }),
      }),
    });
    const existing = { id: 'e1', email: 'existing@example.com', googleId: null, status: UserStatus.ACTIVE, createdAt: new Date() };
    userRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.googleId) return null;
      if (where?.email) return existing;
      if (where?.id) return existing;
      return null;
    });
    userRepo.save.mockImplementation(async (x: any) => x);
    userRoleRepo.find = jest.fn().mockResolvedValue([{ role: { code: RoleCode.CUSTOMER } }]);

    const res = await service.loginWithGoogle('a-valid-looking-google-id-token');
    expect(res.user.email).toBe('existing@example.com');
    expect(existing.googleId).toBe('google-999');
  });

  it('rejects an unverified Google email', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    jest.spyOn<any, any>(service as any, 'getGoogleClient').mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        getPayload: () => ({ sub: 'google-x', email: 'x@example.com', email_verified: false }),
      }),
    });
    await expect(service.loginWithGoogle('token')).rejects.toThrow('not verified');
  });

  it('returns the durable-session refresh result for the verified account', async () => {
    sessions.refresh.mockResolvedValue({userId:'u1',tokens:{accessToken:'new-access-token',refreshToken:'new-refresh-token'}});
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({ sub: 'u1', email: 'a@b.com', type: 'refresh' });
    userRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.id) return { id: 'u1', email: 'a@b.com', status: UserStatus.ACTIVE, createdAt: new Date() };
      return undefined;
    });
    userRoleRepo.find = jest.fn().mockResolvedValue([{ role: { code: RoleCode.CUSTOMER } }]);

    const res = await service.refreshTokens('refresh-token');

    expect(sessions.refresh).toHaveBeenCalledWith('refresh-token');
    expect(res.tokens.accessToken).toBe('new-access-token');
    expect(res.tokens.refreshToken).toBe('new-refresh-token');
  });
});
