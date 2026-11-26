import { Injectable, Logger } from '@nestjs/common';
import { safeFailure } from '../../common/utils/safe-log';

export interface Co2Input {
  weightKg?: number | null;
  sizeUnit?: 'm' | 'inch' | 'ft' | null;
  sizeLength?: number | null;
  sizeBreadth?: number | null;
  sizeHeight?: number | null;
}

/** An activity-emissions response alone does not establish avoided emissions. */
@Injectable()
export class Co2EstimationService {
  private readonly logger = new Logger(Co2EstimationService.name);
  private readonly apiKey = process.env.CLIMATIQ_API_KEY || '';
  private readonly factorId = process.env.CLIMATIQ_EMISSION_FACTOR_ID || '';
  private readonly endpoint = process.env.CLIMATIQ_API_URL || '';
  private readonly methodReference = process.env.CO2_AVOIDED_METHOD_REFERENCE || '';
  private readonly timeoutMs = 10_000;

  private toCubicMeters(input: Co2Input): number | null {
    const { sizeUnit, sizeLength, sizeBreadth, sizeHeight } = input;
    if (![sizeLength, sizeBreadth, sizeHeight].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) return null;
    const scale = sizeUnit === 'm' ? 1 : sizeUnit === 'inch' ? 0.0254 : sizeUnit === 'ft' ? 0.3048 : null;
    if (scale === null) return null;
    const volume = sizeLength! * sizeBreadth! * sizeHeight! * scale ** 3;
    return Number.isFinite(volume) && volume > 0 ? volume : null;
  }

  async estimateSavedCo2Kg(input: Co2Input): Promise<number | null> {
    // This reference identifies the reviewed factor, counterfactual, boundaries
    // and version. Configuring it is a release decision, not proof supplied by code.
    if (!this.apiKey || !this.factorId || !this.methodReference.trim()) return null;
    let endpoint: URL;
    try { endpoint = new URL(this.endpoint); } catch { return null; }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return null;
    const weight = typeof input.weightKg === 'number' && Number.isFinite(input.weightKg) && input.weightKg > 0 ? input.weightKg : null;
    const volume = this.toCubicMeters(input);
    if (weight === null && volume === null) return null;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = (async () => {
        const response = await fetch(endpoint.toString(), {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ emission_factor: { id: this.factorId }, parameters: {
            ...(weight === null ? {} : { weight, weight_unit: 'kg' }),
            ...(volume === null ? {} : { volume, volume_unit: 'm3' }),
          } }),
        });
        if (!response.ok) {
          this.logger.warn({ operation: 'co2_estimate', provider: 'climatiq', status: response.status });
          return null;
        }
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object') return null;
        const { co2e, co2e_unit: unit } = body as Record<string, unknown>;
        if (typeof co2e !== 'number' || !Number.isFinite(co2e) || co2e < 0) return null;
        const scale = unit === 'kg' ? 1 : unit === 'g' ? 0.001 : unit === 't' || unit === 'tonne' ? 1000 : null;
        if (scale === null) return null;
        const value = co2e * scale;
        return Number.isFinite(value) && Number.isFinite(value * 100) ? Math.round(value * 100) / 100 : null;
      })();
      const deadline = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, this.timeoutMs); });
      return await Promise.race([operation, deadline]);
    } catch (error) {
      this.logger.warn(safeFailure('co2_estimate', error));
      return null;
    } finally { if (timer) clearTimeout(timer); }
  }
}
