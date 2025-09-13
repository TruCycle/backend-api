import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendingStatusAndUserNames1700000000006 implements MigrationInterface {
  name = 'AddPendingStatusAndUserNames1700000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ensure enum has 'pending' value
    await queryRunner.query(`
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
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS first_name text`);
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_name text`);

    // Align default to 'pending' for new users
    await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN status SET DEFAULT 'pending'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert default to 'active'
    await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN status SET DEFAULT 'active'`);
    // Columns can remain; keeping data safe. No removal in down.
  }
}

