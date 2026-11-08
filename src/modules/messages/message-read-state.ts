// Explicit IDs acknowledge only viewed messages, never a timestamp watermark.
// Parameters: authenticated viewer UUID, authorized room UUID array.
export const UNREAD_COUNTS_SQL = `SELECT m."roomId" AS "roomId", count(*)::int AS count
FROM public.message m
WHERE m."roomId" = ANY($2::uuid[]) AND m.category = 'direct'
  AND m."senderId" IS NOT NULL AND m."senderId" <> $1::uuid
  AND NOT EXISTS (SELECT 1 FROM public.message_read_receipt r WHERE r.user_id = $1::uuid AND r.message_id = m.id)
GROUP BY m."roomId"`;

// Parameters: authenticated viewer, authorized room, explicitly submitted IDs.
export const INSERT_READ_RECEIPTS_SQL = `INSERT INTO public.message_read_receipt(user_id, message_id)
SELECT $1::uuid, m.id FROM public.message m
WHERE m."roomId" = $2::uuid AND m.id = ANY($3::uuid[])
  AND m.category = 'direct' AND m."senderId" IS NOT NULL AND m."senderId" <> $1::uuid
ON CONFLICT (user_id, message_id) DO NOTHING`;
