import { MigrationInterface, QueryRunner } from 'typeorm';

export class SetUserStatusDefaultPending1700000000007 implements MigrationInterface {
  name = 'SetUserStatusDefaultPending1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN status SET DEFAULT 'pending'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN status SET DEFAULT 'active'`);
  }
}

