import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClaimsTable1700000000009 implements MigrationInterface {
  name = 'CreateClaimsTable1700000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'claim_status_enum') THEN
          CREATE TYPE claim_status_enum AS ENUM ('pending_approval','approved','rejected','cancelled');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS claim (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        item_id uuid NOT NULL,
        collector_id uuid NOT NULL,
        status claim_status_enum NOT NULL DEFAULT 'pending_approval',
        approved_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_claim_item FOREIGN KEY (item_id) REFERENCES item(id) ON DELETE CASCADE,
        CONSTRAINT fk_claim_collector FOREIGN KEY (collector_id) REFERENCES "user"(id) ON DELETE CASCADE,
        CONSTRAINT uq_claim_item UNIQUE (item_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_claim_collector ON claim(collector_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_claim_collector`);
    await queryRunner.query(`DROP TABLE IF EXISTS claim`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'claim_status_enum') THEN
          DROP TYPE claim_status_enum;
        END IF;
      END $$;
    `);
  }
}
