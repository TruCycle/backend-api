import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendShopContactHoursCategories1700000000016 implements MigrationInterface {
  name = 'ExtendShopContactHoursCategories1700000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE shop
      ADD COLUMN IF NOT EXISTS phone_number text NULL,
      ADD COLUMN IF NOT EXISTS opening_hours jsonb NULL,
      ADD COLUMN IF NOT EXISTS acceptable_categories jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE shop
      DROP COLUMN IF EXISTS acceptable_categories,
      DROP COLUMN IF EXISTS opening_hours,
      DROP COLUMN IF EXISTS phone_number
    `);
  }
}

