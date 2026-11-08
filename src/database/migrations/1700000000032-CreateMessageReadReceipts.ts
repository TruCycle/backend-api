import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMessageReadReceipts1700000000032 implements MigrationInterface {
  name = 'CreateMessageReadReceipts1700000000032';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE public.message_read_receipt (
      user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
      message_id uuid NOT NULL REFERENCES public.message(id) ON DELETE CASCADE,
      read_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (user_id, message_id)
    )`);
    await queryRunner.query('CREATE INDEX idx_message_read_receipt_message ON public.message_read_receipt(message_id)');
    await queryRunner.query('ALTER TABLE public.message_read_receipt ENABLE ROW LEVEL SECURITY');
    await queryRunner.query('REVOKE ALL ON TABLE public.message_read_receipt FROM PUBLIC');
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE public.message_read_receipt FROM anon; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE public.message_read_receipt FROM authenticated; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN REVOKE ALL ON TABLE public.message_read_receipt FROM service_role; END IF;
    END $$`);
  }

  async down(): Promise<void> {
    throw new Error('Roll back application code while retaining durable read receipts; destructive rollback requires separate review');
  }
}
