import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFoundItemsTables1700000000025 implements MigrationInterface {
  name = 'CreateFoundItemsTables1700000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'found_item_status_enum') THEN
          CREATE TYPE found_item_status_enum AS ENUM ('available','claimed','picked_up','expired','reported');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'found_item_claim_status_enum') THEN
          CREATE TYPE found_item_claim_status_enum AS ENUM ('pending','acknowledged','completed','cancelled');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'found_item_report_status_enum') THEN
          CREATE TYPE found_item_report_status_enum AS ENUM ('pending','reviewed','resolved');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS found_item (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        poster_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        title text NOT NULL,
        description text NOT NULL DEFAULT '',
        category text NOT NULL,
        condition text NULL,
        status found_item_status_enum NOT NULL DEFAULT 'available',
        address text NULL,
        neighborhood text NULL,
        postcode text NOT NULL,
        latitude double precision NULL,
        longitude double precision NULL,
        images jsonb NOT NULL DEFAULT '[]'::jsonb,
        view_count integer NOT NULL DEFAULT 0,
        posted_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS found_item_claim (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        found_item_id uuid NOT NULL REFERENCES found_item(id) ON DELETE CASCADE,
        claimer_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        message text NULL,
        status found_item_claim_status_enum NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_found_item_claim_item_claimer UNIQUE (found_item_id, claimer_id)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS found_item_report (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        found_item_id uuid NOT NULL REFERENCES found_item(id) ON DELETE CASCADE,
        reporter_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        reason text NOT NULL,
        details text NULL,
        status found_item_report_status_enum NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS found_item_posted_idx ON found_item(status, posted_at DESC);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS found_item_poster_idx ON found_item(poster_id, posted_at DESC);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS found_item_claim_item_idx ON found_item_claim(found_item_id, created_at DESC);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS found_item_report_item_idx ON found_item_report(found_item_id, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS found_item_report_item_idx');
    await queryRunner.query('DROP INDEX IF EXISTS found_item_claim_item_idx');
    await queryRunner.query('DROP INDEX IF EXISTS found_item_poster_idx');
    await queryRunner.query('DROP INDEX IF EXISTS found_item_posted_idx');
    await queryRunner.query('DROP TABLE IF EXISTS found_item_report');
    await queryRunner.query('DROP TABLE IF EXISTS found_item_claim');
    await queryRunner.query('DROP TABLE IF EXISTS found_item');

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'found_item_report_status_enum') THEN
          DROP TYPE found_item_report_status_enum;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'found_item_claim_status_enum') THEN
          DROP TYPE found_item_claim_status_enum;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'found_item_status_enum') THEN
          DROP TYPE found_item_status_enum;
        END IF;
      END $$;
    `);
  }
}
