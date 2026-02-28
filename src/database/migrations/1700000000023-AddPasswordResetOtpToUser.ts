import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetOtpToUser1700000000023 implements MigrationInterface {
  name = 'AddPasswordResetOtpToUser1700000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "reset_otp_hash" text');
    await queryRunner.query('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "reset_otp_expires_at" timestamptz');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "user" DROP COLUMN IF EXISTS "reset_otp_expires_at"');
    await queryRunner.query('ALTER TABLE "user" DROP COLUMN IF EXISTS "reset_otp_hash"');
  }
}
