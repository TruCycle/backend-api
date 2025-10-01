import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMessagesTables1700000000013 implements MigrationInterface {
  name = 'CreateMessagesTables1700000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS message_room (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_one_id uuid NOT NULL,
        user_two_id uuid NOT NULL,
        pair_key text NOT NULL,
        deleted boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_message_room_user_one FOREIGN KEY (user_one_id) REFERENCES "user"(id) ON DELETE CASCADE,
        CONSTRAINT fk_message_room_user_two FOREIGN KEY (user_two_id) REFERENCES "user"(id) ON DELETE CASCADE,
        CONSTRAINT chk_message_room_users CHECK (user_one_id <> user_two_id)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_message_room_pair_key ON message_room(pair_key)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_message_room_user_one ON message_room(user_one_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_message_room_user_two ON message_room(user_two_id)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_category_enum') THEN
          CREATE TYPE message_category_enum AS ENUM ('direct','general');
        END IF;
      END$$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS message (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        room_id uuid NOT NULL,
        sender_id uuid NULL,
        category message_category_enum NOT NULL DEFAULT 'direct',
        image_url text NULL,
        caption text NULL,
        text text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_message_room FOREIGN KEY (room_id) REFERENCES message_room(id) ON DELETE CASCADE,
        CONSTRAINT fk_message_sender FOREIGN KEY (sender_id) REFERENCES "user"(id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_message_room_id ON message(room_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_message_created_at ON message(created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_message_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_message_room_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS message`);
    await queryRunner.query(`DROP TYPE IF EXISTS message_category_enum`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_message_room_user_two`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_message_room_user_one`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_message_room_pair_key`);
    await queryRunner.query(`DROP TABLE IF EXISTS message_room`);
  }
}
