export function normalizePostcode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ')
}

export function resolveOutwardPostcode(value?: string | null): string | null {
  if (!value) {
    return null
  }

  const normalized = normalizePostcode(value)
  return normalized.split(' ')[0] || null
}