import { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueClaimPerCollectorPerItem1700000000019 implements MigrationInterface {
  name = 'UniqueClaimPerCollectorPerItem1700000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // First, remove any historical duplicates so the unique constraint can be applied safely.
    // Strategy: keep one "winner" per (item_id, collector_id) group prioritizing
    // COMPLETE > APPROVED > PENDING_APPROVAL > REJECTED > CANCELLED, then earliest created_at.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY item_id, collector_id
            ORDER BY
              CASE
                WHEN status = 'complete'::claim_status_enum THEN 1
                WHEN status = 'approved'::claim_status_enum THEN 2
                WHEN status = 'pending_approval'::claim_status_enum THEN 3
                WHEN status = 'rejected'::claim_status_enum THEN 4
                WHEN status = 'cancelled'::claim_status_enum THEN 5
                ELSE 6
              END,
              created_at ASC,
              id ASC
          ) AS rn
        FROM claim
      )
      DELETE FROM claim c
      USING ranked r
      WHERE c.id = r.id
        AND r.rn > 1;
    `);

    // Add a composite unique constraint to ensure a collector can only claim a given item once
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_name = 'claim'
            AND constraint_name = 'uq_claim_item_collector'
            AND constraint_type = 'UNIQUE'
        ) THEN
          ALTER TABLE claim ADD CONSTRAINT uq_claim_item_collector UNIQUE (item_id, collector_id);
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_name = 'claim'
            AND constraint_name = 'uq_claim_item_collector'
        ) THEN
          ALTER TABLE claim DROP CONSTRAINT uq_claim_item_collector;
        END IF;
      END
      $$;
    `);
  }
}
