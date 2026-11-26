import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import { defer, finalize, Observable } from 'rxjs';

import { optionalLimit, TokenBucket } from '../../common/security/token-bucket';
import type { AccessPrincipal } from '../../common/security/access-token';
import { releaseLogFields } from '../../common/utils/safe-log';

const minuteMs = 60_000;
const maxTrackedAccounts = 1_000;

@Injectable()
export class VisionBudgetInterceptor implements NestInterceptor {
  private readonly logger = new Logger(VisionBudgetInterceptor.name);
  private readonly rate = new TokenBucket(optionalLimit('VISION_REQUESTS_PER_MINUTE') ?? 30);
  private readonly requestsPerAccount = optionalLimit('VISION_REQUESTS_PER_ACCOUNT_PER_MINUTE') ?? 6;
  private readonly maxConcurrent = optionalLimit('VISION_MAX_CONCURRENT_REQUESTS') ?? 2;
  private readonly accounts = new Map<string, { bucket: TokenBucket; lastSeen: number }>();
  private inFlight = 0;
  private lastLogAt = Number.NEGATIVE_INFINITY;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return defer(() => {
      const http = context.switchToHttp();
      const { user } = http.getRequest<Request & { user: AccessPrincipal }>();
      const response = http.getResponse<Response>();
      if (this.inFlight >= this.maxConcurrent) this.reject(response, 'concurrency', 1);
      const now = performance.now();
      const existing = this.accounts.get(user.id);
      if (!existing && this.accounts.size >= maxTrackedAccounts) {
        for (const [id, entry] of this.accounts) {
          if (now - entry.lastSeen >= minuteMs) this.accounts.delete(id);
        }
        if (this.accounts.size >= maxTrackedAccounts) this.reject(response, 'account_capacity', 60);
      }
      const bucket = existing?.bucket ?? new TokenBucket(this.requestsPerAccount);
      if (!bucket.take()) this.reject(response, 'account_rate', Math.ceil(60 / this.requestsPerAccount));
      if (existing) existing.lastSeen = now;
      if (!this.rate.take()) this.reject(response, 'rate', 60);
      if (!existing) this.accounts.set(user.id, { bucket, lastSeen: now });
      this.inFlight++;
      return defer(() => next.handle()).pipe(finalize(() => { this.inFlight--; }));
    });
  }

  private reject(response: Response, reason: 'concurrency' | 'rate' | 'account_rate' | 'account_capacity', retrySeconds: number): never {
    const now = performance.now();
    if (now - this.lastLogAt >= minuteMs) {
      this.lastLogAt = now;
      this.logger.warn(JSON.stringify({ event: 'vision_budget', outcome: 'limited', reason, ...releaseLogFields() }));
    }
    response.setHeader('Retry-After', String(retrySeconds));
    throw new HttpException('Image analysis is busy. Try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
