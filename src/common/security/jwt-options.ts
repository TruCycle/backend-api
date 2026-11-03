import type { JwtModuleOptions } from '@nestjs/jwt';

export function buildJwtOptions(environment: NodeJS.ProcessEnv): JwtModuleOptions {
  const secret = environment.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret.trim(), 'utf8') < 32 ||
      ['dev-secret', 'change-me', 'secret'].includes(secret.trim().toLowerCase())) {
    throw new Error('JWT_SECRET must be explicitly configured with at least 32 bytes');
  }
  // Preserve the configured key exactly; never silently trim or rotate a key.
  return { secret, signOptions: { expiresIn: environment.JWT_EXPIRES_IN || '15m' } };
}
