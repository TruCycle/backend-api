import { applyDecorators, CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Optional, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { DataSource } from 'typeorm';

const operations = ['register', 'login', 'google', 'resend', 'reset_request', 'reset_attempt'] as const;
type Operation = typeof operations[number];
const operationKey = Symbol('auth-rate-limit-operation');

export function parseAuthRateLimits(value?: string): ReadonlyMap<Operation, number> {
  if (!value?.trim()) return new Map();
  const invalid = () => new Error('AUTH_RATE_LIMITS must specify a positive integer budget for every supported operation');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw invalid(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== operations.length) throw invalid();
  const limits = new Map<Operation, number>();
  for (const operation of operations) {
    const limit = record[operation];
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1_000_000) throw invalid();
    limits.set(operation, limit);
  }
  return limits;
}

// One row per operation. Rejected attempts leave the counter capped, and a
// delayed statement cannot replace a newer window with an older one.
const consume = `WITH bucket AS MATERIALIZED (
  SELECT floor(extract(epoch FROM clock_timestamp()))::bigint AS second
), accepted AS (
  INSERT INTO public.auth_rate_counter AS counter (operation, window_minute, hits)
  SELECT $1, second / 60, 1 FROM bucket
  ON CONFLICT (operation) DO UPDATE SET
    window_minute = EXCLUDED.window_minute,
    hits = CASE WHEN counter.window_minute < EXCLUDED.window_minute THEN 1 ELSE counter.hits + 1 END
  WHERE counter.window_minute < EXCLUDED.window_minute
     OR (counter.window_minute = EXCLUDED.window_minute AND counter.hits < $2)
  RETURNING operation
)
SELECT EXISTS(SELECT 1 FROM accepted) AS allowed, (60 - second % 60)::integer AS retry_after FROM bucket`;

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly limits = parseAuthRateLimits(process.env.AUTH_RATE_LIMITS);

  constructor(private readonly reflector: Reflector, @Optional() @InjectDataSource() private readonly database?: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const operation = this.reflector.get<Operation>(operationKey, context.getHandler());
    const limit = operation && this.limits.get(operation);
    if (!limit) return true;

    let result: { allowed?: unknown; retry_after?: unknown } | undefined;
    try {
      const rows = await this.database?.query(consume, [operation, limit]);
      result = rows?.[0];
    } catch {
      throw new ServiceUnavailableException('Authentication is temporarily unavailable');
    }
    if (!result || typeof result.allowed !== 'boolean' || typeof result.retry_after !== 'number' ||
        !Number.isInteger(result.retry_after) || result.retry_after < 1 || result.retry_after > 60) {
      throw new ServiceUnavailableException('Authentication is temporarily unavailable');
    }
    if (result.allowed) return true;
    context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(result.retry_after));
    throw new HttpException('Too many requests. Try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

export const LimitAuthOperation = (operation: Operation) => applyDecorators(SetMetadata(operationKey, operation), UseGuards(AuthRateLimitGuard));
