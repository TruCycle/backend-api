import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPostcode1700000000017 implements MigrationInterface {
  name = 'AddUserPostcode1700000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS postcode text NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS postcode`,
    );
  }
}

