import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { ItemLocation } from './item-location.interface';

@Injectable()
export class ItemGeocodingService {
  private readonly logger = new Logger(ItemGeocodingService.name);
  private readonly endpoint = process.env.OSM_SEARCH_URL || 'https://nominatim.openstreetmap.org/search';
  private readonly reverseEndpoint = process.env.OSM_REVERSE_URL || 'https://nominatim.openstreetmap.org/reverse';
  private readonly userAgent =
    process.env.OSM_USER_AGENT || 'TruCycleBackend/0.1 (+https://trucycle.com/contact)';
  private readonly requestTimeoutMs = Number(process.env.OSM_TIMEOUT_MS || 5000);

  async forwardGeocode(query: string): Promise<ItemLocation> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new BadRequestException('Address information is required');
    }

    const fetchFn: any = (globalThis as any).fetch;
    if (typeof fetchFn !== 'function') {
      this.logger.error('Global fetch is not available in this runtime');
      throw new Error('Geocoder unavailable');
    }

    const AbortCtor: any = (globalThis as any).AbortController;
    const controller = typeof AbortCtor === 'function' ? new AbortCtor() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.requestTimeoutMs) : null;

    const queryOnce = async (q: string) => {
      const params = new URLSearchParams({
        q,
        format: 'jsonv2',
        limit: '1',
        addressdetails: '0',
      });
      const url = `${this.endpoint}?${params.toString()}`;
      const res = await fetchFn(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
          'Accept-Language': 'en',
        },
        signal: controller ? controller.signal : undefined,
      });
      if (!res || typeof res.status !== 'number') {
        throw new Error('Unexpected geocoder response');
      }
      if (res.status === 429) {
        this.logger.warn('Geocoder throttled the request (429)');
      }
      if (!res.ok) {
        this.logger.warn(`Geocoder responded with status ${res.status}`);
        throw new Error(`Geocoder responded with status ${res.status}`);
      }
      const payload: any = await res.json();
      if (Array.isArray(payload) && payload.length > 0) {
        return payload[0];
      }
      return null;
    };

    try {
      // First attempt: as-is
      let result: any = await queryOnce(trimmed);

      // Heuristic fallbacks
      if (!result) {
        // Try extracting a UK postcode and geocoding that alone
        const ukPostcodeMatch = trimmed.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
        if (ukPostcodeMatch?.[1]) {
          const pc = ukPostcodeMatch[1].toUpperCase().replace(/\s+/g, ' ');
          this.logger.debug(`Fallback geocoding with postcode only: ${pc}`);
          result = await queryOnce(pc);
        }
      }

      if (!result) {
        // Try last comma-separated token (often most specific)
        const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
        if (parts.length > 1) {
          const last = parts[parts.length - 1];
          if (last && last.toLowerCase() !== trimmed.toLowerCase()) {
            this.logger.debug(`Fallback geocoding with trailing token: ${last}`);
            result = await queryOnce(last);
          }
        }
      }

      if (!result) {
        throw new BadRequestException('Unable to geocode the supplied address');
      }

      const latitude = Number(result.lat);
      const longitude = Number(result.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new BadRequestException('Geocoder returned invalid coordinates');
      }
      return { latitude, longitude };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        this.logger.warn('Geocoding request timed out');
        throw new Error('Geocoding request timed out');
      }
      if (err instanceof BadRequestException) {
        throw err;
      }
      this.logger.error('Failed to call geocoder', err instanceof Error ? err.stack : err);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<{
    latitude: number;
    longitude: number;
    postcode: string | null;
    addressLine: string | null;
    neighborhood: string | null;
  }> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new BadRequestException('Valid latitude and longitude are required');
    }

    const fetchFn: any = (globalThis as any).fetch;
    if (typeof fetchFn !== 'function') {
      this.logger.error('Global fetch is not available in this runtime');
      throw new Error('Geocoder unavailable');
    }

    const AbortCtor: any = (globalThis as any).AbortController;
    const controller = typeof AbortCtor === 'function' ? new AbortCtor() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.requestTimeoutMs) : null;

    try {
      const params = new URLSearchParams({
        lat: latitude.toString(),
        lon: longitude.toString(),
        format: 'jsonv2',
        addressdetails: '1',
        zoom: '18',
      });
      const url = `${this.reverseEndpoint}?${params.toString()}`;
      const res = await fetchFn(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
          'Accept-Language': 'en',
        },
        signal: controller ? controller.signal : undefined,
      });

      if (!res || typeof res.status !== 'number') {
        throw new Error('Unexpected geocoder response');
      }
      if (!res.ok) {
        this.logger.warn(`Reverse geocoder responded with status ${res.status}`);
        throw new Error(`Reverse geocoder responded with status ${res.status}`);
      }

      const payload: any = await res.json();
      const address = typeof payload?.address === 'object' && payload.address !== null ? payload.address : {};
      const postcode =
        typeof address.postcode === 'string' && address.postcode.trim().length > 0
          ? address.postcode.trim().toUpperCase().replace(/\s+/g, ' ')
          : null;
      const road = typeof address.road === 'string' && address.road.trim().length > 0 ? address.road.trim() : null;
      const houseNumber =
        typeof address.house_number === 'string' && address.house_number.trim().length > 0
          ? address.house_number.trim()
          : null;
      const neighborhoodCandidates = [
        address.neighbourhood,
        address.suburb,
        address.quarter,
        address.hamlet,
        address.village,
        address.city_district,
      ];
      const neighborhood = neighborhoodCandidates.find(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      )?.trim() ?? null;

      return {
        latitude,
        longitude,
        postcode,
        addressLine: road ? [houseNumber, road].filter(Boolean).join(' ') : null,
        neighborhood,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        this.logger.warn('Reverse geocoding request timed out');
        throw new Error('Reverse geocoding request timed out');
      }
      if (err instanceof BadRequestException) {
        throw err;
      }
      this.logger.error('Failed to call reverse geocoder', err instanceof Error ? err.stack : err);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
