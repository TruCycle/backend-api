import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { ItemLocation } from './item-location.interface';

type JsonObject = Record<string, unknown>;
const asObject = (value: unknown): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
function coordinate(value: unknown, limit: number): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
}
function aborted(): Error {
  const error = new Error('Geocoding request cancelled');
  error.name = 'AbortError';
  return error;
}

type ProviderBudget = { inFlight: number; retryAt: number; lastLimitLogAt: number };
// Nest registers this service in several feature modules. Forward and reverse
// requests to the same provider need one budget across all of those instances.
const providerBudgets = new Map<string, ProviderBudget>();
const PROVIDER_COOLDOWN_MS = 5_000;

function getProviderBudget(endpoint: string): ProviderBudget {
  const origin = new URL(endpoint).origin;
  const existing = providerBudgets.get(origin);
  if (existing) return existing;
  const budget = { inFlight: 0, retryAt: 0, lastLimitLogAt: Number.NEGATIVE_INFINITY };
  providerBudgets.set(origin, budget);
  return budget;
}

function retryDelay(response: Response, now: number): number {
  if (response.status !== 429 && response.status !== 503) return 0;
  const header = response.headers?.get('Retry-After')?.trim();
  if (header) {
    const delay = /^\d+$/.test(header) ? Number(header) * 1_000 : Date.parse(header) - now;
    if (Number.isFinite(delay) && delay > 0) return delay;
  }
  return response.status === 429 ? PROVIDER_COOLDOWN_MS : 0;
}

@Injectable()
export class ItemGeocodingService {
  private readonly logger = new Logger(ItemGeocodingService.name);
  private readonly endpoint = process.env.OSM_SEARCH_URL || 'https://nominatim.openstreetmap.org/search';
  private readonly reverseEndpoint = process.env.OSM_REVERSE_URL || 'https://nominatim.openstreetmap.org/reverse';
  private readonly userAgent = process.env.OSM_USER_AGENT || 'TruCycleBackend/0.1 (+https://trucycle.co.uk)';
  private readonly maxConcurrentRequests = (() => {
    const configured = Number(process.env.OSM_MAX_CONCURRENT_REQUESTS);
    return Number.isInteger(configured) && configured >= 1 && configured <= 32 ? configured : 8;
  })();
  private readonly requestTimeoutMs = (() => {
    const configured = Number(process.env.OSM_TIMEOUT_MS ?? 5000);
    return Number.isFinite(configured) && configured > 0 ? Math.min(30_000, Math.max(1, Math.floor(configured))) : 5000;
  })();

  private async withDeadline<T>(label: string, callerSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (callerSignal?.aborted) throw aborted();
    if (typeof globalThis.fetch !== 'function' || typeof AbortController !== 'function') throw new Error('Geocoder unavailable');
    const controller = new AbortController();
    let failure: Error | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel = () => {};
    const deadline = new Promise<never>((_resolve, reject) => {
      cancel = () => { failure = aborted(); controller.abort(); reject(failure); };
      callerSignal?.addEventListener('abort', cancel, { once: true });
      timeout = setTimeout(() => {
        failure = new Error(label + ' request timed out');
        failure.name = 'GeocodingTimeoutError';
        controller.abort(); reject(failure);
      }, this.requestTimeoutMs);
    });
    try {
      // Race the whole operation, including response-body parsing and fallbacks.
      // An abort-ignoring transport cannot return late success or start a fallback.
      return await Promise.race([operation(controller.signal), deadline]);
    } catch (error) {
      if (failure) throw failure;
      // Never log the supplied address, provider body, request URL or raw stack.
      if (!(error instanceof BadRequestException) && !(error instanceof ServiceUnavailableException)) {
        this.logger.warn(label + ' lookup failed');
      }
      throw error;
    } finally { clearTimeout(timeout); callerSignal?.removeEventListener('abort', cancel); }
  }

  private async requestJson(endpoint: string, params: URLSearchParams, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw aborted();
    const budget = getProviderBudget(endpoint);
    const now = Date.now();
    const reason = now < budget.retryAt ? 'provider_cooldown' : 'concurrency';
    if (reason === 'provider_cooldown' || budget.inFlight >= this.maxConcurrentRequests) {
      if (now - budget.lastLimitLogAt >= 60_000) {
        budget.lastLimitLogAt = now;
        this.logger.warn(JSON.stringify({ event: 'geocoder_provider_budget', outcome: 'limited', reason }));
      }
      throw new ServiceUnavailableException('Location lookup temporarily unavailable');
    }
    budget.inFlight++;
    try {
      return await this.fetchJson(endpoint, params, signal, budget);
    } finally {
      budget.inFlight--;
    }
  }

  private async fetchJson(endpoint: string, params: URLSearchParams, signal: AbortSignal, budget: ProviderBudget): Promise<unknown> {
    let response: Response;
    try {
      response = await globalThis.fetch(endpoint + '?' + params.toString(), {
        method: 'GET', headers: { 'User-Agent': this.userAgent, Accept: 'application/json', 'Accept-Language': 'en' }, signal,
      });
    } catch {
      if (signal.aborted) throw aborted();
      // Transport errors may embed a URL/address; do not forward them to Nest's
      // default exception logger, which logs uncaught Error messages/stacks.
      throw new Error('Unable to contact geocoder');
    }
    if (signal.aborted) throw aborted();
    if (!response || typeof response.status !== 'number' || !Number.isFinite(response.status)) throw new Error('Unexpected geocoder response');
    if (!response.ok) {
      const now = Date.now();
      const delay = retryDelay(response, now);
      if (delay > 0) budget.retryAt = Math.max(budget.retryAt, now + delay);
      void response.body?.cancel().catch(() => undefined);
      throw new Error('Geocoder responded with status ' + response.status);
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error('Unexpected geocoder response'); }
    if (signal.aborted) throw aborted();
    return payload;
  }

  async forwardGeocode(query: string, signal?: AbortSignal): Promise<ItemLocation> {
    if (typeof query !== 'string' || !query.trim()) throw new BadRequestException('Address information is required');
    const trimmed = query.trim();
    const candidates = [trimmed];
    const match = trimmed.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
    if (match) {
      const compact = match[1].toUpperCase().replace(/\s+/g, '');
      candidates.push(compact.slice(0, -3) + ' ' + compact.slice(-3));
    }
    const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) candidates.push(parts[parts.length - 1]);
    // Existing heuristic candidates are only used for genuine empty results;
    // identical postcode spellings must not generate extra provider requests.
    const seen = new Set<string>();
    const distinct = candidates.filter((candidate) => {
      const key = candidate.toUpperCase().replace(/\s+/g, '');
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    return this.withDeadline('Geocoding', signal, async (requestSignal) => {
      for (const candidate of distinct) {
        const payload = await this.requestJson(this.endpoint, new URLSearchParams({ q: candidate, format: 'jsonv2', limit: '1', addressdetails: '0' }), requestSignal);
        if (!Array.isArray(payload)) throw new Error('Unexpected geocoder response');
        if (payload.length === 0) continue;
        const result = asObject(payload[0]);
        if (result && 'error' in result) throw new BadRequestException('Unable to geocode the supplied address');
        const latitude = coordinate(result?.lat, 90);
        const longitude = coordinate(result?.lon, 180);
        if (latitude === null || longitude === null) throw new BadRequestException('Geocoder returned invalid coordinates');
        return { latitude, longitude };
      }
      throw new BadRequestException('Unable to geocode the supplied address');
    });
  }

  async reverseGeocode(latitude: number, longitude: number, signal?: AbortSignal): Promise<{
    latitude: number; longitude: number; postcode: string | null; addressLine: string | null; neighborhood: string | null;
  }> {
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || coordinate(latitude, 90) === null || coordinate(longitude, 180) === null) {
      throw new BadRequestException('Valid latitude and longitude are required');
    }
    return this.withDeadline('Reverse geocoding', signal, async (requestSignal) => {
      const payload = asObject(await this.requestJson(this.reverseEndpoint, new URLSearchParams({
        lat: String(latitude), lon: String(longitude), format: 'jsonv2', addressdetails: '1', zoom: '18',
      }), requestSignal));
      if (!payload || 'error' in payload || coordinate(payload.lat, 90) === null || coordinate(payload.lon, 180) === null) {
        throw new BadRequestException('Unable to reverse geocode the supplied coordinates');
      }
      const address = asObject(payload.address) ?? {};
      const postcode = text(address.postcode)?.toUpperCase().replace(/\s+/g, ' ') ?? null;
      const road = text(address.road);
      const houseNumber = text(address.house_number);
      const neighborhood = [address.neighbourhood, address.suburb, address.quarter, address.hamlet, address.village, address.city_district]
        .map(text).find((value) => value !== null) ?? null;
      // Nominatim returns a nearby OSM object's centroid. Keep the requested GPS
      // point; never silently replace it with that object's coordinates.
      return { latitude, longitude, postcode, addressLine: road ? [houseNumber, road].filter(Boolean).join(' ') : null, neighborhood };
    });
  }
}
