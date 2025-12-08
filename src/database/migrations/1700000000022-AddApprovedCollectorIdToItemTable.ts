import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApprovedCollectorIdToItemTable1700000000022 implements MigrationInterface {
  name = 'AddApprovedCollectorIdToItemTable1700000000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE item ADD COLUMN IF NOT EXISTS approved_collector_id uuid NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE item DROP COLUMN IF EXISTS approved_collector_id`
    );
  }
}
