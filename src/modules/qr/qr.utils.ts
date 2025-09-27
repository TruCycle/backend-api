export function sanitizeShopId(input: unknown): string {
  if (typeof input !== 'string') {
    return '';
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }
  const normalized = trimmed.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return normalized;
}
