import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUuidExtension1700000000002 implements MigrationInterface {
  name = 'CreateUuidExtension1700000000002';

  public async up(_queryRunner: QueryRunner): Promise<void> {
    await _queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Extension may be used by other objects; keep it in place on down.
    // If you must drop, uncomment the following line:
    // await _queryRunner.query('DROP EXTENSION IF EXISTS "uuid-ossp"');
  }
}

