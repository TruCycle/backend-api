import { projectFoundItemLocation, publicLocationPoint } from './public-location';

describe('Stable public angular location', () => {
  it.each([
    [51.5077, 0.068, 51.51, 0.07], [-51.5077, -0.068, -51.51, -0.07],
    [0, 0, 0.01, 0.01], [90, 180, 89.99, 179.99], [-90, -180, -89.99, -179.99],
    [51.52, -0.08, 51.53, -0.07],
  ])('maps %s,%s to the bounded stable centre', (lat, lng, expectedLat, expectedLng) => {
    expect(publicLocationPoint(lat, lng)).toEqual({ latitude: expectedLat, longitude: expectedLng });
    expect(publicLocationPoint(lat, lng)).toEqual(publicLocationPoint(lat, lng));
  });
  it('gives the same public point to distinct points in one cell', () => {
    expect(publicLocationPoint(51.5001, -0.0799)).toEqual(publicLocationPoint(51.5199, -0.0601));
  });
  it.each([[null, 0], [0, undefined], [NaN, 2], [Infinity, 2], [91, 0], [-91, 0], [0, 181], [0, -181], ['51', 0]])
  ('marks unsupported coordinate pair %j,%j unavailable', (latitude, longitude) => {
    expect(publicLocationPoint(latitude, longitude)).toBeNull();
  });
  it.each([false, true])('never fabricates a zero point for missing owner=%s location', (owner) => {
    expect(projectFoundItemLocation({ postcode: 'E162RD' }, owner)).toMatchObject({ latitude: null, longitude: null, precision: 'unavailable' });
  });
  it('returns only structured approximate data to a non-owner', () => {
    expect(projectFoundItemLocation({ latitude: 51.5077, longitude: 0.068,
      postcode: 'E162RD', address: 'PRIVATE_STREET', neighborhood: 'PRIVATE_NEIGHBORHOOD' }, false)).toEqual({
      latitude: 51.51, longitude: 0.07, postcode: 'E16', address: null, neighborhood: null, precision: 'approximate',
    });
  });
  it('preserves exact owner data without altering the source', () => {
    const source = { latitude: 51.5077, longitude: 0.068, postcode: 'E16 2RD', address: 'Owner address', neighborhood: 'Owner area' };
    expect(projectFoundItemLocation(source, true)).toEqual({ ...source, precision: 'exact' });
    expect(source.postcode).toBe('E16 2RD');
  });
  it('returns null outward area for malformed address strings', () => {
    expect(projectFoundItemLocation({ latitude: 1, longitude: 2, postcode: 'PRIVATE_STREET E162RD' }, false).postcode).toBeNull();
  });
});
