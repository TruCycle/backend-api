import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleAuthToUser1700000000027 implements MigrationInterface {
  name = 'AddGoogleAuthToUser1700000000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "google_id" text',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_google_id" ON "user" ("google_id") WHERE "google_id" IS NOT NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "UQ_user_google_id"');
    await queryRunner.query('ALTER TABLE "user" DROP COLUMN IF EXISTS "google_id"');
  }
}
