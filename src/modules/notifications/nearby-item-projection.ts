import { resolveOutwardPostcode } from '../../common/utils/postcode';

export const NEARBY_ITEM_SOURCE = 'nearby-item-v1';
export function nearbyItemProjection(itemId: string, title: unknown, postcode: unknown) {
  const itemTitle = typeof title === 'string' && title.trim() ? title.trim() : null;
  const area = resolveOutwardPostcode(typeof postcode === 'string' ? postcode : null);
  return {
    title: 'New item available nearby',
    body: (itemTitle ? 'A new item “' + itemTitle + '”' : 'A new item') +
      ' has been listed for exchange or donation near your area.' + (area ? ' Approximate area: ' + area + '.' : ''),
    data: { source: NEARBY_ITEM_SOURCE, itemId, itemTitle, itemPostcode: area, locationPrecision: 'approximate' },
  };
}
