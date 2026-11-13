import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { releaseLogFields } from '../../common/utils/safe-log';
import { EmailService } from '../notifications/email.service';
import { buildPasswordResetOtpEmailTemplate, buildVerifyEmailTemplate } from '../notifications/email-templates';
import { User, UserStatus } from '../users/user.entity';

type JobPayload = { email: string } & (
  { kind: 'verification'; token: string; frontendOrigin: string } |
  { kind: 'password_reset'; otp: string; otpHash: string }
);

type Job = {
  id: string;
  user_id: string;
  kind: JobPayload['kind'];
  payload: Buffer;
  expires_at: Date;
  attempts: number;
};

const retrySeconds = [15, 30, 60, 120];
type DeliveryEvent = {
  kind: JobPayload['kind'];
  outcome: 'accepted' | 'rejected' | 'retry_scheduled' | 'delivery_exhausted' | 'stale' | 'decrypt_failed';
};

@Injectable()
export class AuthEmailOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthEmailOutboxService.name);
  private readonly key: Buffer | undefined;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;

  constructor(@InjectDataSource() private readonly database: DataSource, private readonly email: EmailService) {
    if (process.env.AUTH_EMAIL_OUTBOX_ENABLED !== 'true') return;
    const key = process.env.AUTH_EMAIL_OUTBOX_KEY;
    if (!key || !/^[a-f0-9]{64}$/i.test(key)) {
      throw new Error('AUTH_EMAIL_OUTBOX_KEY must be a random 32-byte hexadecimal key');
    }
    if (process.env.DB_LOGGING === 'true') throw new Error('The auth email outbox requires DB_LOGGING=false');
    this.key = Buffer.from(key, 'hex');
  }

  get enabled(): boolean {
    return this.key !== undefined;
  }

  onModuleInit() {
    if (this.enabled) this.schedule();
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  async enqueue(manager: EntityManager, userId: string, payload: JobPayload, expiresAt: Date): Promise<void> {
    if (!this.key) throw new Error('Auth email outbox is disabled');
    const id = randomUUID();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(`${id}:${userId}:${payload.kind}:${expiresAt.getTime()}`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    const envelope = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    await manager.query(`INSERT INTO public.auth_email_outbox (id, user_id, kind, payload, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, kind) DO UPDATE SET id = EXCLUDED.id, payload = EXCLUDED.payload,
        expires_at = EXCLUDED.expires_at, next_attempt_at = EXCLUDED.next_attempt_at, attempts = 0`,
    [id, userId, payload.kind, envelope, expiresAt]);
  }

  async discard(manager: EntityManager, userId: string, kind: JobPayload['kind']): Promise<void> {
    if (!this.enabled) return;
    await manager.query('DELETE FROM public.auth_email_outbox WHERE user_id = $1 AND kind = $2', [userId, kind]);
  }

  private decrypt(job: Job): JobPayload {
    const decipher = createDecipheriv('aes-256-gcm', this.key!, job.payload.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${job.id}:${job.user_id}:${job.kind}:${job.expires_at.getTime()}`));
    decipher.setAuthTag(job.payload.subarray(12, 28));
    const bytes = Buffer.concat([decipher.update(job.payload.subarray(28)), decipher.final()]);
    return JSON.parse(bytes.toString('utf8')) as JobPayload;
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.drain().catch(() => {
        this.logger.warn(JSON.stringify({ event: 'auth_email_outbox', outcome: 'drain_failed', ...releaseLogFields() }));
      }).finally(() => this.schedule());
    }, 5_000);
    this.timer.unref();
  }

  private async drain() {
    await this.database.query(`DELETE FROM public.auth_email_outbox WHERE id IN (
      SELECT id FROM public.auth_email_outbox WHERE expires_at <= clock_timestamp()
      ORDER BY expires_at, id LIMIT 100 FOR UPDATE SKIP LOCKED)`);
    for (let processed = 0; processed < 5 && !this.stopped; processed++) {
      const result = await this.database.transaction(manager => this.deliverNext(manager));
      if (result === null) break;
      if (result === 'skipped') continue;
      const message = JSON.stringify({ event: 'auth_email_outbox', ...result, ...releaseLogFields() });
      if (result.outcome === 'accepted' || result.outcome === 'stale') this.logger.log(message);
      else this.logger.warn(message);
    }
  }

  private async deliverNext(manager: EntityManager): Promise<DeliveryEvent | 'skipped' | null> {
    // Lock accounts first, in the same order as enqueue and credential consumption.
    // Keep the lock through the bounded provider call so a replacement or reset
    // cannot invalidate the credential between eligibility and dispatch.
    const [candidate]: { id: string; user_id: string }[] = await manager.query(`
      SELECT job.id, job.user_id FROM public.auth_email_outbox job
      JOIN public."user" account ON account.id = job.user_id
      WHERE job.next_attempt_at <= clock_timestamp() AND job.expires_at > clock_timestamp()
      ORDER BY job.next_attempt_at, job.id LIMIT 1 FOR UPDATE OF account SKIP LOCKED`);
    if (!candidate) return null;
    const [job]: Job[] = await manager.query(`SELECT * FROM public.auth_email_outbox
      WHERE id = $1 AND next_attempt_at <= clock_timestamp() AND expires_at > clock_timestamp()
      FOR UPDATE SKIP LOCKED`, [candidate.id]);
    if (!job) return 'skipped';

    const user = await manager.getRepository(User).findOne({ where: { id: candidate.user_id }, loadEagerRelations: false });
    let payload: JobPayload;
    try {
      payload = this.decrypt(job);
    } catch {
      // Leave time to correct a mismatched deployment key without blocking other jobs.
      await this.defer(manager, job.id, 60, false);
      return { kind: job.kind, outcome: 'decrypt_failed' };
    }
    const remainingMs = job.expires_at.getTime() - Date.now();
    if (!user || user.email !== payload.email || remainingMs <= 0 ||
        user.status === UserStatus.DELETED || user.status === UserStatus.SUSPENDED ||
        (payload.kind === 'verification' && user.status !== UserStatus.PENDING) ||
        (payload.kind === 'password_reset' && (user.resetOtpHash !== payload.otpHash ||
          user.resetOtpExpiresAt?.getTime() !== job.expires_at.getTime()))) {
      await this.remove(manager, job.id);
      return { kind: job.kind, outcome: 'stale' };
    }

    const message = payload.kind === 'verification'
      ? {
        subject: 'Verify your email',
        html: buildVerifyEmailTemplate({ firstName: user.firstName,
          verifyUrl: `${payload.frontendOrigin}/auth/verify-email?token=${encodeURIComponent(payload.token)}` }),
      }
      : {
        subject: 'Your password reset OTP',
        html: buildPasswordResetOtpEmailTemplate({ firstName: user.firstName, otp: payload.otp,
          expiresInMinutes: Math.floor(remainingMs / 60_000), expiresAt: job.expires_at, supportEmail: process.env.SUPPORT_EMAIL }),
      };
    const outcome = await this.email.sendEmail({ ...message, to: user.email, classifyTransientRejections: true });
    const delay = retrySeconds[job.attempts];
    if (outcome.status === 'accepted' || outcome.status === 'rejected' || delay === undefined ||
        Date.now() + delay * 1_000 >= job.expires_at.getTime()) {
      await this.remove(manager, job.id);
      return { kind: job.kind, outcome: outcome.status === 'accepted' || outcome.status === 'rejected'
        ? outcome.status : 'delivery_exhausted' };
    }
    await this.defer(manager, job.id, delay, true);
    return { kind: job.kind, outcome: 'retry_scheduled' };
  }

  private async remove(manager: EntityManager, id: string): Promise<void> {
    await manager.query('DELETE FROM public.auth_email_outbox WHERE id = $1', [id]);
  }

  private async defer(manager: EntityManager, id: string, seconds: number, countAttempt: boolean): Promise<void> {
    await manager.query(`UPDATE public.auth_email_outbox SET attempts = attempts + $3::integer,
      next_attempt_at = clock_timestamp() + $2::integer * interval '1 second' WHERE id = $1`,
    [id, seconds, countAttempt ? 1 : 0]);
  }
}
