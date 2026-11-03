export function normalizePostcode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ')
}

export function resolveOutwardPostcode(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = normalizePostcode(value)
  // Recognise the six standard outward-code shapes, plus historical GIR.
  // Format recognition is not a claim that a district/postcode is allocated.
  // Match the entire input: never echo arbitrary address text or a compact full
  // postcode through a split-on-space fallback at this public display boundary.
  const full = normalized.match(/^([A-Z]{1,2}\d[A-Z\d]?|GIR) ?\d[A-Z]{2}$/)
  if (full) return full[1]
  return /^(?:[A-Z]{1,2}\d[A-Z\d]?|GIR)$/.test(normalized) ? normalized : null
}
