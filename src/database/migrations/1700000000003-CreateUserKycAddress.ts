import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserKycAddress1700000000003 implements MigrationInterface {
  name = 'CreateUserKycAddress1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // user_status enum
    await queryRunner.query(
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status_enum') THEN
          CREATE TYPE user_status_enum AS ENUM ('active','suspended','deleted');
        END IF;
      END $$;`,
    );

    // kyc_status enum
    await queryRunner.query(
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kyc_status_enum') THEN
          CREATE TYPE kyc_status_enum AS ENUM ('pending','approved','rejected');
        END IF;
      END $$;`,
    );

    // user table (idempotent, add missing columns for existing installations)
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "user" (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        email text NOT NULL UNIQUE,
        password_hash text,
        status user_status_enum NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    );
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS phone text`);
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS referred_by uuid NULL`);
    await queryRunner.query(
      `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_user_referred_by'
            AND table_name = 'user'
        ) THEN
          ALTER TABLE "user" ADD CONSTRAINT fk_user_referred_by FOREIGN KEY (referred_by) REFERENCES "user"(id) ON DELETE SET NULL;
        END IF;
      END $$;`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_user_phone ON "user"(phone)`);

    // kyc_profile table
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS kyc_profile (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id uuid NOT NULL UNIQUE,
        status kyc_status_enum NOT NULL DEFAULT 'pending',
        documents jsonb,
        submitted_at timestamptz,
        verified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
      )`,
    );

    // address table
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS address (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id uuid NOT NULL,
        label text,
        line1 text,
        line2 text,
        city text,
        state text,
        country text,
        geom geometry(Point,4326) NOT NULL,
        is_default boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_address_user FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_address_user ON address(user_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS address_geom_gist ON address USING GIST (geom)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS address_geom_gist`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_address_user`);
    await queryRunner.query(`DROP TABLE IF EXISTS address`);
    await queryRunner.query(`DROP TABLE IF EXISTS kyc_profile`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_user_phone`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user"`);
    await queryRunner.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kyc_status_enum') THEN DROP TYPE kyc_status_enum; END IF; END $$;`);
    await queryRunner.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status_enum') THEN DROP TYPE user_status_enum; END IF; END $$;`);
  }
}
