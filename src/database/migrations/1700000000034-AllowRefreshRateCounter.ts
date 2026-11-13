import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowRefreshRateCounter1700000000034 implements MigrationInterface {
  name = 'AllowRefreshRateCounter1700000000034';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE public.auth_rate_counter
      DROP CONSTRAINT auth_rate_counter_operation_check,
      ADD CONSTRAINT auth_rate_counter_operation_check
        CHECK (operation IN ('register', 'login', 'google', 'resend', 'reset_request', 'reset_attempt', 'refresh'))`);
  }

  async down(): Promise<void> {
    throw new Error('Disable the refresh budget and review the counter before rolling back');
  }
}
