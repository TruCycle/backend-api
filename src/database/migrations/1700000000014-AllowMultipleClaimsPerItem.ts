import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowMultipleClaimsPerItem1700000000014 implements MigrationInterface {
  name = 'AllowMultipleClaimsPerItem1700000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the unique constraint on claim(item_id) to allow multiple pending claims per item
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_name = 'claim'
            AND constraint_name = 'uq_claim_item'
            AND constraint_type = 'UNIQUE'
        ) THEN
          ALTER TABLE claim DROP CONSTRAINT uq_claim_item;
        END IF;
      END $$;
    `);

    // Add an index on item_id for efficient lookups
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_claim_item ON claim(item_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the index
    await queryRunner.query(`DROP INDEX IF EXISTS idx_claim_item`);

    // Recreate the unique constraint
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_name = 'claim'
            AND constraint_name = 'uq_claim_item'
        ) THEN
          ALTER TABLE claim ADD CONSTRAINT uq_claim_item UNIQUE (item_id);
        END IF;
      END $$;
    `);
  }
}

