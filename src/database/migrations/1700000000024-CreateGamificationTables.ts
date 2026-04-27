import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGamificationTables1700000000024 implements MigrationInterface {
  name = 'CreateGamificationTables1700000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gamification_streak_type_enum') THEN
          CREATE TYPE gamification_streak_type_enum AS ENUM ('daily','weekly');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gamification_badge_category_enum') THEN
          CREATE TYPE gamification_badge_category_enum AS ENUM ('milestone','streak','impact','community','special');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gamification_badge_rarity_enum') THEN
          CREATE TYPE gamification_badge_rarity_enum AS ENUM ('common','rare','epic','legendary');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_progress (
        user_id uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
        total_points integer NOT NULL DEFAULT 0,
        current_level integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_streak (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        streak_type gamification_streak_type_enum NOT NULL,
        current_streak integer NOT NULL DEFAULT 0,
        longest_streak integer NOT NULL DEFAULT 0,
        last_activity_date date NULL,
        expires_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_user_streak_user_type UNIQUE (user_id, streak_type)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS gamification_badge (
        id text PRIMARY KEY,
        name text NOT NULL,
        description text NOT NULL,
        category gamification_badge_category_enum NOT NULL,
        rarity gamification_badge_rarity_enum NOT NULL,
        icon_url text NULL,
        requirement text NOT NULL,
        points_awarded integer NOT NULL DEFAULT 0,
        sort_order integer NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT TRUE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_badge (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        badge_id text NOT NULL REFERENCES gamification_badge(id) ON DELETE CASCADE,
        earned_at timestamptz NOT NULL DEFAULT now(),
        is_notified boolean NOT NULL DEFAULT FALSE,
        CONSTRAINT uq_user_badge_user_badge UNIQUE (user_id, badge_id)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS point_transaction (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        points integer NOT NULL,
        reason text NOT NULL,
        action_type text NOT NULL,
        action_id text NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS user_badge_user_earned_idx ON user_badge(user_id, earned_at DESC);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS point_transaction_user_occurred_idx ON point_transaction(user_id, occurred_at DESC, created_at DESC);
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS point_transaction_user_action_idx
        ON point_transaction(user_id, action_type, action_id)
        WHERE action_id IS NOT NULL;
    `);

    await queryRunner.query(`
      INSERT INTO gamification_badge (id, name, description, category, rarity, icon_url, requirement, points_awarded, sort_order, is_active)
      VALUES
        ('first-steps', 'First Steps', 'Complete your first exchange', 'milestone', 'common', '', '1 exchange', 40, 10, TRUE),
        ('warming-up', 'Warming Up', 'Keep a 3 day streak alive', 'streak', 'common', '', '3 day streak', 30, 20, TRUE),
        ('earth-saver', 'Earth Saver', 'Save 10 kg of CO2', 'impact', 'rare', '', '10 kg CO2 saved', 75, 30, TRUE),
        ('good-samaritan', 'Good Samaritan', 'Post your first found item', 'community', 'rare', '', '1 found item', 50, 40, TRUE),
        ('community-helper', 'Community Helper', 'Help 5 found items get picked up', 'community', 'epic', '', '5 pickups', 120, 50, TRUE),
        ('app-explorer', 'App Explorer', 'Use every core TruCycle flow', 'special', 'legendary', '', 'Core flows completed', 160, 60, TRUE)
      ON CONFLICT (id) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS point_transaction_user_action_idx');
    await queryRunner.query('DROP INDEX IF EXISTS point_transaction_user_occurred_idx');
    await queryRunner.query('DROP INDEX IF EXISTS user_badge_user_earned_idx');
    await queryRunner.query('DROP TABLE IF EXISTS point_transaction');
    await queryRunner.query('DROP TABLE IF EXISTS user_badge');
    await queryRunner.query('DROP TABLE IF EXISTS gamification_badge');
    await queryRunner.query('DROP TABLE IF EXISTS user_streak');
    await queryRunner.query('DROP TABLE IF EXISTS user_progress');

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gamification_badge_rarity_enum') THEN
          DROP TYPE gamification_badge_rarity_enum;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gamification_badge_category_enum') THEN
          DROP TYPE gamification_badge_category_enum;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gamification_streak_type_enum') THEN
          DROP TYPE gamification_streak_type_enum;
        END IF;
      END $$;
    `);
  }
}
