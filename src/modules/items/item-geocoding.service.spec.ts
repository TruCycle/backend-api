import { BadRequestException, Logger } from '@nestjs/common';

import { ItemGeocodingService } from './item-geocoding.service';

function response(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: jest.fn().mockResolvedValue(payload) } as unknown as Response;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe('ItemGeocodingService synthetic provider boundary', () => {
  let service: ItemGeocodingService;
  let fetchMock: jest.SpyInstance;
  const previousTimeout = process.env.OSM_TIMEOUT_MS;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.OSM_TIMEOUT_MS = '25';
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response([{ lat: '51.5074', lon: '-0.1278' }]));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new ItemGeocodingService();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (previousTimeout === undefined) delete process.env.OSM_TIMEOUT_MS;
    else process.env.OSM_TIMEOUT_MS = previousTimeout;
  });

  it.each([
    ['51.5074', '-0.1278', 51.5074, -0.1278], [0, 0, 0, 0], ['-90', '180', -90, 180],
    ['90', '-180', 90, -180], [' +51.5 ', ' .125 ', 51.5, 0.125],
  ])('accepts bounded coordinates %p/%p', async (lat, lon, latitude, longitude) => {
    fetchMock.mockResolvedValue(response([{ lat, lon }]));
    await expect(service.forwardGeocode('SW1A 1AA')).resolves.toEqual({ latitude, longitude });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([null, undefined, '', ' ', false, true, [], {}, NaN, Infinity, 'Infinity', 'NaN', '0x10', '1e2', '51,5', '90.0001', -91])(
    'rejects invalid provider latitude %p without fallback', async (lat) => {
      fetchMock.mockResolvedValue(response([{ lat, lon: '0.1' }]));
      await expect(service.forwardGeocode('Private Street, SW1A 1AA, London')).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it.each([null, '', false, [], Infinity, '-180.001', 181])('rejects invalid provider longitude %p', async (lon) => {
    fetchMock.mockResolvedValue(response([{ lat: '51.5', lon }]));
    await expect(service.forwardGeocode('SW1A 1AA')).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { error: 'synthetic provider error' }, 'unexpected'])('rejects non-array forward payload %p', async (payload) => {
    fetchMock.mockResolvedValue(response(payload));
    await expect(service.forwardGeocode('Private Street, SW1A 1AA, London')).rejects.toThrow('Unexpected geocoder response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([null, [], 'unexpected', { error: 'synthetic error', lat: '51.5', lon: '0.1' }])('rejects malformed first forward result %p', async (record) => {
    fetchMock.mockResolvedValue(response([record]));
    await expect(service.forwardGeocode('SW1A 1AA')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('preserves fallback order only after genuinely empty results', async () => {
    fetchMock.mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([{ lat: '51.5', lon: '-0.1' }]));
    await expect(service.forwardGeocode('Private Street, SW1A1AA, London')).resolves.toEqual({ latitude: 51.5, longitude: -0.1 });
    const queries = fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('q'));
    expect(queries).toEqual(['Private Street, SW1A1AA, London', 'SW1A 1AA', 'London']);
  });
  it.each(['sw1a1aa', 'SW1A 1AA'])('deduplicates empty standalone postcode %s', async (query) => {
    fetchMock.mockResolvedValue(response([]));
    await expect(service.forwardGeocode(query)).rejects.toThrow('Unable to geocode the supplied address');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('deduplicates postcode and trailing-token fallback candidates', async () => {
    fetchMock.mockResolvedValue(response([]));
    await expect(service.forwardGeocode('Private Street, SW1A1AA')).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([429, 400, 503])('does not retry or fallback after HTTP%s', async (status) => {
    fetchMock.mockResolvedValue(response({}, status));
    await expect(service.forwardGeocode('Private Street, SW1A 1AA, London')).rejects.toThrow('Geocoder responded with status ' + status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed JSON without revealing its raw error or starting fallback', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: jest.fn().mockRejectedValue(new Error('PRIVATE_ADDRESS_SENTINEL')) });
    await expect(service.forwardGeocode('Private Street, SW1A 1AA, London')).rejects.toThrow('Unexpected geocoder response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(jest.mocked(Logger.prototype.warn).mock.calls)).not.toContain('PRIVATE_ADDRESS_SENTINEL');
  });
  it.each([undefined, null, '', ' '])('rejects missing direct-call address %p before transport', async (query) => {
    await expect(service.forwardGeocode(query as unknown as string)).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('times out an abort-ignoring fetch and cannot start fallback after its late result', async () => {
    const held = deferred<Response>(); fetchMock.mockReturnValue(held.promise);
    const pending = service.forwardGeocode('Private Street, SW1A 1AA, London');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'GeocodingTimeoutError' });
    await jest.advanceTimersByTimeAsync(25); await rejected;
    held.resolve(response([])); await jest.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  });
  it('includes JSON parsing in the deadline and ignores late JSON', async () => {
    const held = deferred<unknown>(); fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => held.promise });
    const rejected = expect(service.forwardGeocode('Private Street, SW1A 1AA, London')).rejects.toMatchObject({ name: 'GeocodingTimeoutError' });
    await jest.advanceTimersByTimeAsync(25); await rejected; held.resolve([]); await jest.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('shares one deadline across fallback attempts rather than resetting the budget', async () => {
    const held = deferred<Response>(); fetchMock.mockResolvedValueOnce(response([])).mockReturnValueOnce(held.promise);
    const rejected = expect(service.forwardGeocode('Private Street, SW1A 1AA, London')).rejects.toMatchObject({ name: 'GeocodingTimeoutError' });
    await jest.advanceTimersByTimeAsync(24); expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1); await rejected;
    held.resolve(response([])); await jest.runAllTimersAsync(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('honours caller abort without late success or fallback', async () => {
    const controller = new AbortController(); const held = deferred<Response>(); fetchMock.mockReturnValue(held.promise);
    const pending = service.forwardGeocode('Private Street, SW1A 1AA, London', controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected; held.resolve(response([])); await jest.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  });
  it('does not start a request for an already-aborted caller', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(service.forwardGeocode('SW1A 1AA', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ['', 5000], ['not-a-number', 5000], ['0', 5000], ['-1', 5000],
    ['Infinity', 5000], ['2147483648', 30000], ['0.5', 1],
  ])('bounds configured timeout %p to a safe deadline', async (configured, expected) => {
    process.env.OSM_TIMEOUT_MS = String(configured);
    service = new ItemGeocodingService();
    fetchMock.mockReturnValue(new Promise(() => {}));
    let settled = false;
    const pending = service.forwardGeocode('SW1A 1AA');
    void pending.catch(() => { settled = true; });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'GeocodingTimeoutError' });
    await jest.advanceTimersByTimeAsync(Number(expected) - 1); expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1); await rejected; expect(jest.getTimerCount()).toBe(0);
  });

  it.each([[null, 0], [undefined, 0], ['', 0], [NaN, 0], [91, 0], [-91, 0], [0, 181], [0, -181], [0, Infinity]])(
    'rejects invalid reverse caller coordinates %p/%p before transport', async (lat, lon) => {
      await expect(service.reverseGeocode(lat as number, lon)).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('preserves requested GPS rather than the provider object centroid and maps nullable address fields', async () => {
    fetchMock.mockResolvedValue(response({ lat: '51.6', lon: '-0.2', address: {
      postcode: ' sw1a   1aa ', house_number: ' 34 ', road: ' Example Road ', suburb: ' Synthetic area ',
    } }));
    await expect(service.reverseGeocode(51.5, -0.1)).resolves.toEqual({ latitude: 51.5, longitude: -0.1,
      postcode: 'SW1A 1AA', addressLine: '34 Example Road', neighborhood: 'Synthetic area' });
  });
  it('keeps absent address/postcode nullable instead of inventing a location', async () => {
    fetchMock.mockResolvedValue(response({ lat: '0', lon: '0' }));
    await expect(service.reverseGeocode(0, 0)).resolves.toEqual({ latitude: 0, longitude: 0,
      postcode: null, addressLine: null, neighborhood: null });
  });
  it.each([null, {}, [], { error: 'Unable to geocode' }, { lat: null, lon: 0 }, { lat: 51, lon: '' }, { lat: 91, lon: 0 }])(
    'rejects malformed/error reverse payload %p', async (payload) => {
      fetchMock.mockResolvedValue(response(payload));
      await expect(service.reverseGeocode(51.5, -0.1)).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it('bounds reverse JSON parsing too', async () => {
    const held = deferred<unknown>(); fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => held.promise });
    const rejected = expect(service.reverseGeocode(51.5, -0.1)).rejects.toMatchObject({ name: 'GeocodingTimeoutError' });
    await jest.advanceTimersByTimeAsync(25); await rejected;
    held.resolve({ lat: 51.5, lon: -0.1, address: { postcode: 'SW1A 1AA' } }); await jest.runAllTimersAsync();
    expect(jest.getTimerCount()).toBe(0);
  });
  it('cleans the deadline after a provider transport failure and logs no address', async () => {
    fetchMock.mockRejectedValue(new Error('PRIVATE_ADDRESS_SENTINEL'));
    await expect(service.forwardGeocode('Private Street, SW1A 1AA, London')).rejects.toThrow('Unable to contact geocoder');
    expect(jest.getTimerCount()).toBe(0);
    expect(JSON.stringify(jest.mocked(Logger.prototype.warn).mock.calls)).not.toMatch(/PRIVATE_ADDRESS_SENTINEL|Private Street|SW1A/);
  });
});
