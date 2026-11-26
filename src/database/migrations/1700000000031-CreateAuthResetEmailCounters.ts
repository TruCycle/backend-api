import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthResetEmailCounters1700000000031 implements MigrationInterface {
  name = 'CreateAuthResetEmailCounters1700000000031';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE public.auth_reset_email_counter (
      window_minute bigint NOT NULL CHECK (window_minute >= 0),
      operation text NOT NULL CHECK (operation IN ('reset_request', 'reset_attempt')),
      email_digest bytea NOT NULL CHECK (octet_length(email_digest) = 32),
      hits integer NOT NULL CHECK (hits BETWEEN 1 AND 1000000),
      PRIMARY KEY (window_minute, operation, email_digest)
    )`);
    await queryRunner.query('ALTER TABLE public.auth_reset_email_counter ENABLE ROW LEVEL SECURITY');
    await queryRunner.query('REVOKE ALL ON TABLE public.auth_reset_email_counter FROM PUBLIC');
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE public.auth_reset_email_counter FROM anon; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE public.auth_reset_email_counter FROM authenticated; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN REVOKE ALL ON TABLE public.auth_reset_email_counter FROM service_role; END IF;
    END $$`);
  }

  async down(): Promise<void> {
    throw new Error('Disable and review the reset email limits before any counter rollback');
  }
}
