import { createHmac } from 'crypto';

import { buildJwtOptions } from './jwt-options';

export const AUTH_SESSION_OPTIONS = Symbol('AUTH_SESSION_OPTIONS');
export interface AuthSessionOptions {
  accessSeconds: number;
  refreshSeconds: number;
  retryGraceSeconds: number;
  rotationKey: Buffer;
}
export function tokenLifetime(value: string, label: string): number {
  const match = /^(\d+)(s|m|h|d|w)$/.exec(value);
  const scales: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  const seconds = match ? Number(match[1]) * scales[match[2]] : NaN;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 365 * 86400) {
    throw new Error(`${label} must use an explicit s/m/h/d/w unit and be between1second and365days`);
  }
  return seconds;
}
export function buildAuthSessionOptions(environment: NodeJS.ProcessEnv): AuthSessionOptions {
  const { secret } = buildJwtOptions(environment);
  const accessSeconds = tokenLifetime(environment.JWT_EXPIRES_IN || '15m', 'JWT_EXPIRES_IN');
  const refreshSeconds = tokenLifetime(environment.JWT_REFRESH_EXPIRES_IN || '90d', 'JWT_REFRESH_EXPIRES_IN');
  const retryGraceSeconds = Number(environment.AUTH_REFRESH_RETRY_GRACE_SECONDS || 30);
  if (accessSeconds > refreshSeconds) throw new Error('Access lifetime cannot exceed session lifetime');
  if (!Number.isInteger(retryGraceSeconds) || retryGraceSeconds < 1 || retryGraceSeconds > 60) throw new Error('Refresh retry grace must be between1and60seconds');
  return { accessSeconds, refreshSeconds, retryGraceSeconds,
    rotationKey: createHmac('sha256', secret as string).update('TruCycle refresh rotation v1').digest() };
}
