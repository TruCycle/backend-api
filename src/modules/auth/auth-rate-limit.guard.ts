import { createHmac } from 'node:crypto';

import { applyDecorators, CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, Optional, ServiceUnavailableException, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { DataSource } from 'typeorm';

const operations = ['register', 'login', 'google', 'resend', 'reset_request', 'reset_attempt'] as const;
type Operation = typeof operations[number];
const resetOperations = ['reset_request', 'reset_attempt'] as const;
type ResetOperation = typeof resetOperations[number];
const operationKey = Symbol('auth-rate-limit-operation');

function parseLimits<T extends string>(name: string, keys: readonly T[], value?: string): ReadonlyMap<T, number> {
  if (!value?.trim()) return new Map();
  const invalid = () => new Error(`${name} must specify a positive integer budget for every supported operation`);
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw invalid(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length) throw invalid();
  const limits = new Map<T, number>();
  for (const operation of keys) {
    const limit = record[operation];
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1_000_000) throw invalid();
    limits.set(operation, limit);
  }
  return limits;
}

export function parseAuthRateLimits(value?: string): ReadonlyMap<Operation, number> {
  return parseLimits('AUTH_RATE_LIMITS', operations, value);
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

// A new minute uses a new key. Remove up to two older keys per admitted request
// to outpace new keys without locking live counters or needing a cleanup service.
const consumeResetEmail = `WITH bucket AS MATERIALIZED (
  SELECT floor(extract(epoch FROM clock_timestamp()))::bigint AS second
), expired AS (
  SELECT counter.window_minute, counter.operation, counter.email_digest
  FROM public.auth_reset_email_counter AS counter CROSS JOIN bucket
  WHERE counter.window_minute < bucket.second / 60 - 1
  ORDER BY counter.window_minute, counter.operation, counter.email_digest
  LIMIT 2 FOR UPDATE OF counter SKIP LOCKED
), pruned AS (
  DELETE FROM public.auth_reset_email_counter AS counter USING expired
  WHERE (counter.window_minute, counter.operation, counter.email_digest) =
        (expired.window_minute, expired.operation, expired.email_digest)
), accepted AS (
  INSERT INTO public.auth_reset_email_counter AS counter (window_minute, operation, email_digest, hits)
  SELECT second / 60, $1, $2, 1 FROM bucket
  ON CONFLICT (window_minute, operation, email_digest) DO UPDATE SET hits = counter.hits + 1
  WHERE counter.hits < $3
  RETURNING operation
)
SELECT EXISTS(SELECT 1 FROM accepted) AS allowed, (60 - second % 60)::integer AS retry_after FROM bucket`;

const budgetLogger = new Logger('AuthRateLimits');
const lastBudgetEvent = new Map<string, number>();

function reportBudgetEvent(operation: Operation, scope: 'global' | 'reset_email', outcome: 'limited' | 'unavailable') {
  const key = `${operation}:${scope}:${outcome}`;
  const now = Date.now();
  const last = lastBudgetEvent.get(key);
  if (last !== undefined && now >= last && now - last < 60_000) return;
  lastBudgetEvent.set(key, now);
  const release = process.env.APP_RELEASE_SHA || process.env.RAILWAY_GIT_COMMIT_SHA;
  budgetLogger.warn({
    event: 'auth_rate_limit',
    operation,
    scope,
    outcome,
    ...(release && /^[0-9a-f]{40}$/i.test(release) ? { release } : {}),
  });
}

async function enforceBudget(
  database: DataSource | undefined,
  statement: string,
  parameters: [Operation, ...unknown[]],
  response: Response,
  scope: 'global' | 'reset_email',
) {
  let result: { allowed?: unknown; retry_after?: unknown } | undefined;
  try {
    const rows = await database?.query(statement, parameters);
    result = rows?.[0];
  } catch {
    reportBudgetEvent(parameters[0], scope, 'unavailable');
    throw new ServiceUnavailableException('Authentication is temporarily unavailable');
  }
  if (!result || typeof result.allowed !== 'boolean' || typeof result.retry_after !== 'number' ||
      !Number.isInteger(result.retry_after) || result.retry_after < 1 || result.retry_after > 60) {
    reportBudgetEvent(parameters[0], scope, 'unavailable');
    throw new ServiceUnavailableException('Authentication is temporarily unavailable');
  }
  if (result.allowed) return;
  reportBudgetEvent(parameters[0], scope, 'limited');
  response.setHeader('Retry-After', String(result.retry_after));
  throw new HttpException('Too many requests. Try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly limits = parseAuthRateLimits(process.env.AUTH_RATE_LIMITS);

  constructor(private readonly reflector: Reflector, @Optional() @InjectDataSource() private readonly database?: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const operation = this.reflector.get<Operation>(operationKey, context.getHandler());
    const limit = operation && this.limits.get(operation);
    if (!limit) return true;

    await enforceBudget(this.database, consume, [operation, limit], context.switchToHttp().getResponse<Response>(), 'global');
    return true;
  }
}

@Injectable()
export class AuthResetEmailLimiter {
  private readonly limits = parseLimits('AUTH_RESET_EMAIL_LIMITS', resetOperations, process.env.AUTH_RESET_EMAIL_LIMITS);
  private readonly key?: Buffer;

  constructor(@Optional() @InjectDataSource() private readonly database?: DataSource) {
    if (!this.limits.size) return;
    if (!parseAuthRateLimits(process.env.AUTH_RATE_LIMITS).size) {
      throw new Error('AUTH_RESET_EMAIL_LIMITS requires AUTH_RATE_LIMITS');
    }
    if (process.env.DB_LOGGING === 'true') {
      throw new Error('AUTH_RESET_EMAIL_LIMITS requires DB_LOGGING=false');
    }
    const key = process.env.AUTH_RESET_EMAIL_LIMIT_KEY;
    if (!key || !/^[0-9a-f]{64}$/i.test(key)) {
      throw new Error('AUTH_RESET_EMAIL_LIMIT_KEY must be a random 32-byte key in hexadecimal');
    }
    this.key = Buffer.from(key, 'hex');
  }

  async consume(operation: ResetOperation, email: string, response: Response) {
    const limit = this.limits.get(operation);
    if (!limit || !this.key) return;
    const digest = createHmac('sha256', this.key)
      .update(`${operation}:${email.trim().toLowerCase()}`)
      .digest();
    await enforceBudget(this.database, consumeResetEmail, [operation, digest, limit], response, 'reset_email');
  }
}

export const LimitAuthOperation = (operation: Operation) => applyDecorators(SetMetadata(operationKey, operation), UseGuards(AuthRateLimitGuard));
