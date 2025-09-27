import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClaimCompletionAndScanEvents1700000000011 implements MigrationInterface {
  name = 'AddClaimCompletionAndScanEvents1700000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'claim_status_enum'
            AND e.enumlabel = 'complete'
        ) THEN
          ALTER TYPE claim_status_enum ADD VALUE 'complete';
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'claim'
            AND column_name = 'completed_at'
        ) THEN
          ALTER TABLE claim
            ADD COLUMN completed_at timestamptz NULL;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS item_scan_event (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        item_id uuid NOT NULL,
        scan_type text NOT NULL,
        shop_id text NULL,
        scanned_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_item_scan_event_item FOREIGN KEY (item_id)
          REFERENCES item(id) ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_item_scan_event_item
        ON item_scan_event(item_id, scanned_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_item_scan_event_item;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS item_scan_event;
    `);

    await queryRunner.query(`
      ALTER TABLE claim DROP COLUMN IF EXISTS completed_at;
    `);

    await queryRunner.query(`
      UPDATE claim
      SET status = 'approved'
      WHERE status = 'complete';
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'claim_status_enum'
        ) THEN
          CREATE TYPE claim_status_enum_old AS ENUM ('pending_approval','approved','rejected','cancelled');
          ALTER TABLE claim
            ALTER COLUMN status DROP DEFAULT,
            ALTER COLUMN status TYPE claim_status_enum_old USING status::text::claim_status_enum_old;
          DROP TYPE claim_status_enum;
          ALTER TYPE claim_status_enum_old RENAME TO claim_status_enum;
        END IF;
      END
      $$;
    `);
  }
}
