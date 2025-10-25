import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationTable1700000000020 implements MigrationInterface {
  name = 'CreateNotificationTable1700000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "type" text NOT NULL,
        "title" text NOT NULL,
        "body" text NULL,
        "data" jsonb NULL,
        "read" boolean NOT NULL DEFAULT false,
        "read_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS notification_user_read_created_idx
      ON "notification" ("user_id", "read", "created_at" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS notification_user_read_created_idx');
    await queryRunner.query('DROP TABLE IF EXISTS "notification"');
  }
}

