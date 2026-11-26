import { PUBLIC_LOCATION_CELL_DEGREES, projectFoundItemLocation } from '../../common/utils/public-location';

interface ItemLocationInput {
  latitude?: number | null;
  longitude?: number | null;
  postcode?: string | null;
  addressLine?: string | null;
}
export function projectItemLocation(item: ItemLocationInput, isOwner: boolean) {
  const projected = projectFoundItemLocation({ ...item, address: item.addressLine }, isOwner);
  return { address_line: projected.address, postcode: projected.postcode,
    latitude: projected.latitude, longitude: projected.longitude, precision: projected.precision };
}

// Fixed column names and policy constants only, never caller-provided SQL.
// Match the numeric coordinate source and grid arithmetic used by public detail,
// claims and notification targeting. No exact-geometry membership prefilter.
const scale = 1 / PUBLIC_LOCATION_CELL_DEGREES;
const publicLongitude = '(LEAST(FLOOR(item.longitude * ' + scale + '), ' + (180 * scale - 1) + ') + 0.5) / ' + scale;
const publicLatitude = '(LEAST(FLOOR(item.latitude * ' + scale + '), ' + (90 * scale - 1) + ') + 0.5) / ' + scale;
export const PUBLIC_ITEM_GEOGRAPHY_SQL = 'CASE WHEN item.latitude BETWEEN -90 AND 90 AND item.longitude BETWEEN -180 AND 180' +
  ' THEN ST_SetSRID(ST_MakePoint(' + publicLongitude + ', ' + publicLatitude + '), 4326)::geography ELSE NULL END';
