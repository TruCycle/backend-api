import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateItemListing1700000000008 implements MigrationInterface {
  name = 'CreateItemListing1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_pickup_option_enum') THEN
          CREATE TYPE item_pickup_option_enum AS ENUM ('donate','exchange','recycle');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_status_enum') THEN
          CREATE TYPE item_status_enum AS ENUM (
            'draft','active','claimed','complete','pending_dropoff','awaiting_collection',
            'rejected','pending_recycle','pending_recycle_processing','recycled'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_condition_enum') THEN
          CREATE TYPE item_condition_enum AS ENUM ('new','like_new','good','fair','poor');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS item (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        donor_id uuid NOT NULL,
        title text NOT NULL,
        description text NULL,
        condition item_condition_enum NOT NULL,
        category text NOT NULL,
        pickup_option item_pickup_option_enum NOT NULL,
        status item_status_enum NOT NULL,
        dropoff_location_id uuid NULL,
        delivery_preferences text NULL,
        address_line text NOT NULL,
        postcode text NOT NULL,
        images jsonb NOT NULL DEFAULT '[]'::jsonb,
        metadata jsonb NULL,
        location geometry(Point,4326) NOT NULL,
        latitude double precision NOT NULL,
        longitude double precision NOT NULL,
        qr_code_url text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_item_donor FOREIGN KEY (donor_id) REFERENCES "user"(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_item_status_pickup ON item(status, pickup_option)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_item_location_gix ON item USING GIST (location)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_item_location_gix`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_item_status_pickup`);
    await queryRunner.query(`DROP TABLE IF EXISTS item`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_condition_enum') THEN
          DROP TYPE item_condition_enum;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_status_enum') THEN
          DROP TYPE item_status_enum;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_pickup_option_enum') THEN
          DROP TYPE item_pickup_option_enum;
        END IF;
      END $$;
    `);
  }
}
