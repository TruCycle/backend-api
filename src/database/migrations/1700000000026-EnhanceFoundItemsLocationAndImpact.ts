import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnhanceFoundItemsLocationAndImpact1700000000026 implements MigrationInterface {
  name = 'EnhanceFoundItemsLocationAndImpact1700000000026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE found_item ADD COLUMN IF NOT EXISTS weight_kg double precision NULL`);
    await queryRunner.query(`ALTER TABLE found_item ADD COLUMN IF NOT EXISTS estimated_co2e_kg integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE found_item ADD COLUMN IF NOT EXISTS impact_points integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE found_item ADD COLUMN IF NOT EXISTS is_fly_tipped boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS found_item_postcode_idx ON found_item(postcode)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS found_item_postcode_idx');
    await queryRunner.query('ALTER TABLE found_item DROP COLUMN IF EXISTS is_fly_tipped');
    await queryRunner.query('ALTER TABLE found_item DROP COLUMN IF EXISTS impact_points');
    await queryRunner.query('ALTER TABLE found_item DROP COLUMN IF EXISTS estimated_co2e_kg');
    await queryRunner.query('ALTER TABLE found_item DROP COLUMN IF EXISTS weight_kg');
  }
}