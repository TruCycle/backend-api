import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserProfileImageAndItemCo2AndReviews1700000000012 implements MigrationInterface {
  name = 'AddUserProfileImageAndItemCo2AndReviews1700000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add profile_image_url to user
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS profile_image_url text NULL`,
    );

    // Add estimated_co2_saved_kg to item
    await queryRunner.query(
      `ALTER TABLE item ADD COLUMN IF NOT EXISTS estimated_co2_saved_kg double precision NULL`,
    );

    // Create user_review table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_review (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        target_user_id uuid NOT NULL,
        reviewer_user_id uuid NOT NULL,
        rating numeric(2,1) NOT NULL CHECK (rating >= 0 AND rating <= 5),
        comment text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_review_target_user FOREIGN KEY (target_user_id) REFERENCES "user"(id) ON DELETE CASCADE,
        CONSTRAINT fk_review_reviewer_user FOREIGN KEY (reviewer_user_id) REFERENCES "user"(id) ON DELETE CASCADE,
        CONSTRAINT uq_reviewer_target UNIQUE (reviewer_user_id, target_user_id)
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_user_review_target ON user_review(target_user_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_user_review_target`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_review`);
    await queryRunner.query(
      `ALTER TABLE item DROP COLUMN IF EXISTS estimated_co2_saved_kg`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS profile_image_url`,
    );
  }
}

