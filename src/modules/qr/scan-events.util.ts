import { EntityManager } from 'typeorm';

export interface ItemScanEventResponse {
  scan_type: string;
  shop_id: string | null;
  scanned_at: string | null;
}

export async function recordScanEvent(
  manager: EntityManager,
  itemId: string,
  scanType: string,
  shopId: string | null,
  scannedAt: Date,
): Promise<void> {
  const normalizedType = typeof scanType === 'string' ? scanType.trim().toUpperCase().slice(0, 60) : '';
  if (!normalizedType) {
    throw new Error('scanType is required');
  }
  const normalizedShop = typeof shopId === 'string' && shopId.trim() ? shopId.trim().slice(0, 64) : null;
  const timestamp = scannedAt instanceof Date && !Number.isNaN(scannedAt.getTime()) ? scannedAt : new Date();
  await manager.query(
    'INSERT INTO item_scan_event (item_id, scan_type, shop_id, scanned_at) VALUES ($1, $2, $3, $4)',
    [itemId, normalizedType, normalizedShop, timestamp],
  );
}

export async function fetchScanEvents(
  manager: EntityManager,
  itemId: string,
  limit = 25,
): Promise<ItemScanEventResponse[]> {
  const cappedLimit = Math.min(Math.max(Number(limit) || 0, 1), 50);
  const rows: any[] = await manager.query(
    'SELECT scan_type, shop_id, scanned_at FROM item_scan_event WHERE item_id = $1 ORDER BY scanned_at DESC LIMIT $2',
    [itemId, cappedLimit],
  );
  const events: ItemScanEventResponse[] = [];
  for (const row of rows || []) {
    if (!row) continue;
    const scanType =
      typeof row.scan_type === 'string'
        ? row.scan_type.trim().toUpperCase().slice(0, 60)
        : null;
    if (!scanType) continue;
    const shopId = typeof row.shop_id === 'string' ? row.shop_id.trim().slice(0, 64) || null : null;
    let scannedAt: string | null = null;
    const rawDate = row.scanned_at instanceof Date ? row.scanned_at : row.scanned_at ? new Date(row.scanned_at) : null;
    if (rawDate && !Number.isNaN(rawDate.getTime())) {
      scannedAt = rawDate.toISOString();
    }
    events.push({ scan_type: scanType, shop_id: shopId, scanned_at: scannedAt });
    if (events.length >= cappedLimit) {
      break;
    }
  }
  return events;
}
