import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePrivateMessageAttachments1700000000033 implements MigrationInterface {
  name = 'CreatePrivateMessageAttachments1700000000033';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE public.message ADD COLUMN "hasAttachment" boolean NOT NULL DEFAULT false');
    await queryRunner.query(`CREATE TABLE public.message_attachment (
      message_id uuid PRIMARY KEY REFERENCES public.message(id) ON DELETE CASCADE,
      uploader_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
      content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
      payload bytea NOT NULL,
      byte_count integer NOT NULL CHECK (byte_count BETWEEN 1 AND 524288 AND byte_count = octet_length(payload)),
      source_digest bytea NOT NULL CHECK (octet_length(source_digest) = 32)
    )`);
    await queryRunner.query('CREATE INDEX idx_message_attachment_uploader ON public.message_attachment(uploader_id)');
    await queryRunner.query('ALTER TABLE public.message_attachment ENABLE ROW LEVEL SECURITY');
    await queryRunner.query('REVOKE ALL ON TABLE public.message_attachment FROM PUBLIC');
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE public.message_attachment FROM anon; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE public.message_attachment FROM authenticated; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN REVOKE ALL ON TABLE public.message_attachment FROM service_role; END IF;
    END $$`);
  }

  async down(): Promise<void> {
    throw new Error('Roll back application code while retaining private attachments; destructive rollback requires separate review');
  }
}
