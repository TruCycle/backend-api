import { MigrationInterface, QueryRunner } from 'typeorm';

// Preparation only. Do not apply before resolving 0027 ledger/index drift,
// verifying private backend role grants and approving lifecycle activation.
export class FoundItemLifecycle1700000000028 implements MigrationInterface {
  name = 'FoundItemLifecycle1700000000028';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE found_item_status_enum ADD VALUE IF NOT EXISTS 'gone'`);
    await queryRunner.query(`ALTER TABLE found_item
      ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL,
      ADD COLUMN IF NOT EXISTS expiry_nudged_at timestamptz NULL`);
    // Historical nulls deliberately remain unscheduled until explicit reconfirmation.
    await queryRunner.query(`CREATE TABLE found_item_observation (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      found_item_id uuid NOT NULL REFERENCES found_item(id) ON DELETE CASCADE,
      observer_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('still_there', 'gone')),
      observed_at timestamptz NOT NULL,
      CONSTRAINT uq_found_item_observation_item_observer UNIQUE(found_item_id, observer_id)
    )`);
    await queryRunner.query(`CREATE INDEX found_item_lifecycle_due_idx ON found_item(expires_at, id)
      WHERE status IN ('available','claimed') AND last_seen_at IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX found_item_observation_observer_idx ON found_item_observation(observer_id)`);
    await queryRunner.query(`ALTER TABLE found_item_observation ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`REVOKE ALL ON TABLE found_item_observation FROM PUBLIC`);
    await queryRunner.query(`DO $$ DECLARE role_name text; BEGIN
      FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format('REVOKE ALL ON TABLE found_item_observation FROM %I', role_name);
        END IF;
      END LOOP;
    END $$`);
    // No direct-client identity policies: the application authenticates via custom Nest JWT.
    // Release must verify an explicitly authorised backend role can access this private table.
  }
  async down(_queryRunner: QueryRunner): Promise<void> {
    throw new Error('Lifecycle rollback is fail-closed: observations, timestamps and GONE history must be retained. Prepare a reviewed forward fix or data-preserving rollback.');
  }
}
