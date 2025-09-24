import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';

function makeCtx(authHeader?: string): any {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authHeader ? { authorization: authHeader } : {} }),
    }),
  } as any;
}

describe('JwtAuthGuard header parsing', () => {
  const payload = { sub: 'user-1' };
  let jwt: any;

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
  });

  it('accepts standard Bearer token', async () => {
    const guard = new JwtAuthGuard(jwt);
    await expect(guard.canActivate(makeCtx('Bearer abc.def.ghi'))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('accepts lower-case bearer', async () => {
    const guard = new JwtAuthGuard(jwt);
    await expect(guard.canActivate(makeCtx('bearer abc.def.ghi'))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('handles double Bearer prefix (Swagger pasted with Bearer)', async () => {
    const guard = new JwtAuthGuard(jwt);
    await expect(guard.canActivate(makeCtx('Bearer Bearer abc.def.ghi'))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('strips surrounding double quotes', async () => {
    const guard = new JwtAuthGuard(jwt);
    await expect(guard.canActivate(makeCtx('Bearer "abc.def.ghi"'))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('strips surrounding single quotes', async () => {
    const guard = new JwtAuthGuard(jwt);
    await expect(guard.canActivate(makeCtx("Bearer 'abc.def.ghi'"))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('throws on missing header', async () => {
    const guard = new JwtAuthGuard(jwt);
    await expect(guard.canActivate(makeCtx())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws invalid token when verification fails', async () => {
    jwt.verifyAsync.mockRejectedValueOnce(new Error('bad'));
    const guard = new JwtAuthGuard(jwt);
    await expect(guard.canActivate(makeCtx('Bearer bad.token'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
