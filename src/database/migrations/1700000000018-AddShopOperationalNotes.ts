import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShopOperationalNotes1700000000018 implements MigrationInterface {
  name = 'AddShopOperationalNotes1700000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE shop
      ADD COLUMN IF NOT EXISTS operational_notes text NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE shop
      DROP COLUMN IF EXISTS operational_notes
    `);
  }
}

