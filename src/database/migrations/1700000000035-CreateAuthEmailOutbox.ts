import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthEmailOutbox1700000000035 implements MigrationInterface {
  name = 'CreateAuthEmailOutbox1700000000035';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE public.auth_email_outbox (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('verification', 'password_reset')),
      payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 29 AND 16384),
      expires_at timestamptz NOT NULL,
      next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
      UNIQUE (user_id, kind)
    )`);
    await queryRunner.query('CREATE INDEX auth_email_outbox_due ON public.auth_email_outbox (next_attempt_at, id)');
    await queryRunner.query('CREATE INDEX auth_email_outbox_expiry ON public.auth_email_outbox (expires_at, id)');
    await queryRunner.query('ALTER TABLE public.auth_email_outbox ENABLE ROW LEVEL SECURITY');
    await queryRunner.query('REVOKE ALL ON TABLE public.auth_email_outbox FROM PUBLIC');
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE public.auth_email_outbox FROM anon; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE public.auth_email_outbox FROM authenticated; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN REVOKE ALL ON TABLE public.auth_email_outbox FROM service_role; END IF;
    END $$`);
  }

  async down(): Promise<void> {
    throw new Error('Disable the auth email outbox and review queued deliveries before removing it');
  }
}
