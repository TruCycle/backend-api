import { resolveOutwardPostcode } from './postcode';

// Versioned angular cells, not a fixed metre radius or an anonymity guarantee.
export const PUBLIC_LOCATION_POLICY = 'angular-cell-v1-0.02deg';
export const PUBLIC_LOCATION_CELL_DEGREES = 0.02;
export interface GeoPoint { readonly latitude: number; readonly longitude: number }
interface StoredLocation {
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly postcode?: string | null;
  readonly address?: string | null;
  readonly neighborhood?: string | null;
}
export function validLocationPoint(latitude: unknown, longitude: unknown): GeoPoint | null {
  return typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    ? { latitude, longitude } : null;
}
export function publicLocationPoint(latitude: unknown, longitude: unknown): GeoPoint | null {
  const point = validLocationPoint(latitude, longitude);
  if (!point) return null;
  const scale = 1 / PUBLIC_LOCATION_CELL_DEGREES;
  const centre = (coordinate: number, maximum: number) => {
    const index = Math.min(Math.floor(coordinate * scale), maximum * scale - 1);
    return (index + 0.5) / scale;
  };
  return { latitude: centre(point.latitude, 90), longitude: centre(point.longitude, 180) };
}
export function projectFoundItemLocation(location: StoredLocation, isOwner: boolean) {
  const point = isOwner ? validLocationPoint(location.latitude, location.longitude)
    : publicLocationPoint(location.latitude, location.longitude);
  return {
    latitude: point?.latitude ?? null,
    longitude: point?.longitude ?? null,
    address: isOwner ? location.address ?? null : null,
    neighborhood: isOwner ? location.neighborhood ?? null : null,
    postcode: isOwner ? location.postcode ?? null : resolveOutwardPostcode(location.postcode),
    precision: point ? isOwner ? 'exact' as const : 'approximate' as const : 'unavailable' as const,
  };
}
