import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClaimApprovedAt1700000000010 implements MigrationInterface {
  name = 'AddClaimApprovedAt1700000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'claim'
            AND column_name = 'approved_at'
        ) THEN
          ALTER TABLE claim
            ADD COLUMN approved_at timestamptz NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE claim DROP COLUMN IF EXISTS approved_at;
    `);
  }
}
