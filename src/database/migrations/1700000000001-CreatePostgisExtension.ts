import { MigrationInterface, QueryRunner } from 'typeorm';

export class PostgisExtensionMigration1700000000001 implements MigrationInterface {
  name = 'PostgisExtensionMigration1700000000001';

  public async up(_queryRunner: QueryRunner): Promise<void> {
    await _queryRunner.query('CREATE EXTENSION IF NOT EXISTS postgis');
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: keep extension
  }
}
