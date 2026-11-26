import type { MigrationInterface, QueryRunner } from 'typeorm';

// Before durable read receipts, production kept no read state, so every
// historical incoming message would count as unread on first deploy.
// Mark messages that existed before this release as read for their recipient.
export class BackfillMessageReadReceipts1700000000036 implements MigrationInterface {
  name = 'BackfillMessageReadReceipts1700000000036';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`INSERT INTO public.message_read_receipt(user_id, message_id, read_at)
      SELECT CASE WHEN m."senderId" = r."userOneId" THEN r."userTwoId" ELSE r."userOneId" END, m.id, m."createdAt"
      FROM public.message m
      JOIN public.message_room r ON r.id = m."roomId"
      WHERE m.category = 'direct' AND m."senderId" IS NOT NULL
        AND m."senderId" IN (r."userOneId", r."userTwoId")
        AND r."userOneId" IS NOT NULL AND r."userTwoId" IS NOT NULL
      ON CONFLICT (user_id, message_id) DO NOTHING`);
  }

  async down(): Promise<void> {
    // Backfilled receipts are indistinguishable from real ones; leave them in place.
  }
}
