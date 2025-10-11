import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateShopTable1700000000015 implements MigrationInterface {
  name = 'CreateShopTable1700000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS shop (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        owner_user_id uuid NOT NULL,
        name text NOT NULL,
        address_line text NOT NULL,
        postcode text NOT NULL,
        latitude double precision NOT NULL,
        longitude double precision NOT NULL,
        geom geometry(Point, 4326) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_shop_owner FOREIGN KEY (owner_user_id) REFERENCES "user"(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_shop_owner ON shop(owner_user_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS shop_geom_gist ON shop USING GIST (geom)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS shop_geom_gist`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_shop_owner`);
    await queryRunner.query(`DROP TABLE IF EXISTS shop`);
  }
}

