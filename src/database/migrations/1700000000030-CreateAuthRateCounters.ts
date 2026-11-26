import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthRateCounters1700000000030 implements MigrationInterface {
  name = 'CreateAuthRateCounters1700000000030';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE public.auth_rate_counter (
      operation text PRIMARY KEY CHECK (operation IN ('register', 'login', 'google', 'resend', 'reset_request', 'reset_attempt')),
      window_minute bigint NOT NULL CHECK (window_minute >= 0),
      hits integer NOT NULL CHECK (hits BETWEEN 1 AND 1000000)
    )`);
    await queryRunner.query('ALTER TABLE public.auth_rate_counter ENABLE ROW LEVEL SECURITY');
    await queryRunner.query('REVOKE ALL ON TABLE public.auth_rate_counter FROM PUBLIC');
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE public.auth_rate_counter FROM anon; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE public.auth_rate_counter FROM authenticated; END IF;
    END $$`);
  }

  async down(): Promise<void> {
    throw new Error('Disable and review the shared authentication limits before any counter rollback');
  }
}
