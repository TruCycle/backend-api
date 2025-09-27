import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendingStatusAndUserNames1700000000006 implements MigrationInterface {
  name = 'AddPendingStatusAndUserNames1700000000006';

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // Ensure enum has 'pending' value
    await _queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typname = 'user_status_enum' AND e.enumlabel = 'pending'
        ) THEN
          ALTER TYPE user_status_enum ADD VALUE 'pending';
        END IF;
      END$$;
    `);

    // Add first_name / last_name columns if missing
    await _queryRunner.query('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS first_name text');
    await _queryRunner.query('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_name text');

    // Do not set default to 'pending' here to avoid
    // PostgreSQL "unsafe use of new value" error within the same transaction.
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: defaults unchanged here; columns retained for data safety.
  }
}
