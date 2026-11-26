import { MigrationInterface, QueryRunner } from 'typeorm';

// Local preparation only: reviewed migration/cutover/recovery approval required.
export class CreateAuthSessions1700000000029 implements MigrationInterface {
  name = 'CreateAuthSessions1700000000029';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE auth_session (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      refresh_hash char(64) NOT NULL,
      previous_refresh_hash char(64) NULL,
      generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
      refresh_issued_at timestamptz NOT NULL,
      previous_valid_until timestamptz NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz NULL,
      created_at timestamptz NOT NULL,
      last_used_at timestamptz NOT NULL,
      CHECK (expires_at > created_at)
    )`);
    await queryRunner.query('CREATE INDEX auth_session_user_active_idx ON auth_session (user_id) WHERE revoked_at IS NULL');
    await queryRunner.query('CREATE INDEX auth_session_expiry_idx ON auth_session (expires_at)');
    await queryRunner.query('ALTER TABLE auth_session ENABLE ROW LEVEL SECURITY');
    await queryRunner.query('REVOKE ALL ON TABLE auth_session FROM PUBLIC');
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE auth_session FROM anon; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE auth_session FROM authenticated; END IF;
    END $$`);
  }
  async down(): Promise<void> { throw new Error('Auth session history must not be dropped by rollback; use an approved recovery/cutover procedure'); }
}
