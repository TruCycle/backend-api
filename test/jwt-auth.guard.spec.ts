import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthSession } from '../src/modules/auth/auth-session.entity';
import { sessionAccessStub, syntheticSessionId } from '../src/testing/session-access-stub.test-support';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { verifyAccessToken } from '../src/common/security/access-token';
import { JwtAuthModule } from '../src/common/security/jwt-auth.module';
import { buildJwtOptions } from '../src/common/security/jwt-options';
import { ClaimsService } from '../src/modules/claims/claims.service';
import { ItemsController } from '../src/modules/items/items.controller';
import { ItemsService } from '../src/modules/items/items.service';
import { User, UserStatus } from '../src/modules/users/user.entity';

function activeUsers(): Repository<User> {
  return { findOne: async ({ where }: { where: { id: string } }) => ({ id: where.id, status: UserStatus.ACTIVE }) } as unknown as Repository<User>;
}

function makeCtx(authHeader?: string): any {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authHeader ? { authorization: authHeader } : {} }),
    }),
  } as any;
}

describe('JwtAuthGuard header parsing', () => {
  const payload = { sid: syntheticSessionId, sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 };
  let jwt: any;

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
  });

  it('accepts standard Bearer token', async () => {
    const guard = new JwtAuthGuard(jwt, activeUsers(), sessionAccessStub());
    await expect(guard.canActivate(makeCtx('Bearer abc.def.ghi'))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('accepts lower-case bearer', async () => {
    const guard = new JwtAuthGuard(jwt, activeUsers(), sessionAccessStub());
    await expect(guard.canActivate(makeCtx('bearer abc.def.ghi'))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('handles double Bearer prefix (Swagger pasted with Bearer)', async () => {
    const guard = new JwtAuthGuard(jwt, activeUsers(), sessionAccessStub());
    await expect(guard.canActivate(makeCtx('Bearer Bearer abc.def.ghi'))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('strips surrounding double quotes', async () => {
    const guard = new JwtAuthGuard(jwt, activeUsers(), sessionAccessStub());
    await expect(guard.canActivate(makeCtx('Bearer "abc.def.ghi"'))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('strips surrounding single quotes', async () => {
    const guard = new JwtAuthGuard(jwt, activeUsers(), sessionAccessStub());
    await expect(guard.canActivate(makeCtx("Bearer 'abc.def.ghi'"))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('throws on missing header', async () => {
    const guard = new JwtAuthGuard(jwt, activeUsers(), sessionAccessStub());
    await expect(guard.canActivate(makeCtx())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws invalid token when verification fails', async () => {
    jwt.verifyAsync.mockRejectedValueOnce(new Error('bad'));
    const guard = new JwtAuthGuard(jwt, activeUsers(), sessionAccessStub());
    await expect(guard.canActivate(makeCtx('Bearer bad.token'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('JwtAuthGuard signed token purpose boundary', () => {
  // Deliberately synthetic signing key: no runtime config or real account.
  const jwt = new JwtService({ secret: 'unit-test-purpose-boundary-only' });
  const guard = new JwtAuthGuard(jwt, activeUsers(), sessionAccessStub());

  it.each(['refresh', 'verify', 'reset', '', null])(
    'rejects a correctly signed %p-purpose token as an access credential',
    async (type) => {
      const token = await jwt.signAsync({ sid: syntheticSessionId, sub: 'synthetic-user', type }, { expiresIn: '1h' });
      await expect(guard.canActivate(makeCtx(`Bearer ${token}`)))
        .rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it.each([undefined, 'access'])(
    'accepts the existing legacy and explicit access purposes (%p)',
    async (type) => {
      const token = await jwt.signAsync({ sid: syntheticSessionId, sub: 'synthetic-user', ...(type ? { type } : {}) }, { expiresIn: '1h' });
      await expect(guard.canActivate(makeCtx(`Bearer ${token}`))).resolves.toBe(true);
    },
  );

  it('still rejects expired access credentials', async () => {
    const token = await jwt.signAsync({ sid: syntheticSessionId, sub: 'synthetic-user' }, { expiresIn: -1 });
    await expect(guard.canActivate(makeCtx(`Bearer ${token}`)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('Public item optional authentication purpose boundary', () => {
  const jwt = new JwtService({ secret: 'unit-test-item-purpose-only' });
  it.each(['refresh', 'verify', 'access', undefined])('keeps %p credentials in the correct public/owner audience', async (type) => {
    const items = { searchPublicListings: jest.fn(), getPublicItem: jest.fn() };
    const controller = new ItemsController(items as unknown as ItemsService, {} as ClaimsService, jwt, activeUsers(), sessionAccessStub());
    const token = await jwt.signAsync({ sid: syntheticSessionId, sub: 'synthetic-owner', ...(type ? { type } : {}) }, { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    await controller.search({}, req);
    await controller.findOne('synthetic-item', req);
    const viewer = type === 'refresh' || type === 'verify' ? undefined : 'synthetic-owner';
    expect(items.searchPublicListings).toHaveBeenCalledWith({}, viewer);
    expect(items.getPublicItem).toHaveBeenCalledWith('synthetic-item', viewer);
  });
});

describe('Current account and configuration boundary', () => {
  const jwt = new JwtService({ secret: 'synthetic-current-account-key' });
  it.each([UserStatus.PENDING, UserStatus.SUSPENDED, UserStatus.DELETED, null])('rejects current %p account with a valid access signature', async status => {
    const users = { findOne: jest.fn().mockResolvedValue(status ? { id: 'synthetic-user', status } : null) };
    const token = await jwt.signAsync({ sid: syntheticSessionId, sub: 'synthetic-user' }, { expiresIn: '1h' });
    const guard = new JwtAuthGuard(jwt, users as unknown as Repository<User>, sessionAccessStub());
    await expect(guard.canActivate(makeCtx(`Bearer ${token}`))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'synthetic-user' } }));
  });
  it('returns unavailable rather than invalid credentials on account-store failure', async () => {
    const users = { findOne: jest.fn().mockRejectedValue(new Error('private DB diagnostic')) };
    const token = await jwt.signAsync({ sid: syntheticSessionId, sub: 'synthetic-user' }, { expiresIn: '1h' });
    await expect(new JwtAuthGuard(jwt, users as unknown as Repository<User>, sessionAccessStub()).canActivate(makeCtx(`Bearer ${token}`)))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('rejects a signed access token without an expiry', async () => {
    const token = await jwt.signAsync({ sid: syntheticSessionId, sub: 'synthetic-user' });
    const users = { findOne: jest.fn() };
    await expect(verifyAccessToken(jwt, users, token, sessionAccessStub())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.findOne).not.toHaveBeenCalled();
  });
  it('checks expiry again after a delayed account lookup', async () => {
    const now = Date.now();
    const token = await jwt.signAsync({ sid: syntheticSessionId, sub: 'synthetic-user', exp: Math.floor(now / 1000) + 10 });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const users = { findOne: async () => { clock.mockReturnValue(now + 11_000); return { id: 'synthetic-user', status: UserStatus.ACTIVE } as User; } };
      await expect(verifyAccessToken(jwt, users, token, sessionAccessStub())).rejects.toBeInstanceOf(UnauthorizedException);
    } finally { clock.mockRestore(); }
  });
  it.each([undefined, '', 'dev-secret', 'change-me', 'short-key'])('fails closed without a suitable explicit signing key (%p)', secret => {
    expect(() => buildJwtOptions({ JWT_SECRET: secret })).toThrow('JWT_SECRET must be explicitly configured');
  });
  it('preserves an explicit key and configured access lifetime without rotation', () => {
    const key = ' synthetic-configuration-key-at-least-32-bytes ';
    expect(buildJwtOptions({ JWT_SECRET: key, JWT_EXPIRES_IN: '2h' })).toEqual({ secret: key, signOptions: { expiresIn: '2h' } });
  });
  it('treats an inactive optional owner as anonymous and propagates an account-store outage', async () => {
    const items = { getPublicItem: jest.fn() };
    const users = { findOne: jest.fn().mockResolvedValue({ id: 'synthetic-user', status: UserStatus.SUSPENDED }) };
    const controller = new ItemsController(items as unknown as ItemsService, {} as ClaimsService, jwt, users as unknown as Repository<User>, sessionAccessStub());
    const accessToken = await jwt.signAsync({ sid: syntheticSessionId, sub: 'synthetic-user' }, { expiresIn: '1h' });
    const request = { headers: { authorization: `Bearer ${accessToken}` } };
    await controller.findOne('synthetic-item', request);
    expect(items.getPublicItem).toHaveBeenCalledWith('synthetic-item', undefined);
    users.findOne.mockRejectedValue(new Error('synthetic account-store outage'));
    await expect(controller.findOne('synthetic-item', request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(items.getPublicItem).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('actual Nest JWT module validates configuration at factory startup (configured=%s)', async configured => {
    const previous = process.env.JWT_SECRET;
    try {
      if (configured) process.env.JWT_SECRET = 'synthetic-module-signing-key-at-least-32-bytes';
      else delete process.env.JWT_SECRET;
      const build = Test.createTestingModule({ imports: [JwtAuthModule] }).overrideProvider(getRepositoryToken(AuthSession)).useValue({}).compile();
      if (!configured) await expect(build).rejects.toThrow('JWT_SECRET must be explicitly configured');
      else {
        const module = await build;
        try {
          const service = module.get(JwtService);
          const signed = await service.signAsync({ sid: syntheticSessionId, sub: 'synthetic-user', type: 'access' });
          expect(await service.verifyAsync(signed)).toMatchObject({ sid: syntheticSessionId, sub: 'synthetic-user', type: 'access', exp: expect.any(Number) });
        } finally { await module.close(); }
      }
    } finally { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; }
  });
});
