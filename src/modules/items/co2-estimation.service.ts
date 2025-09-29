import { Injectable, Logger } from '@nestjs/common';

export interface Co2Input {
  weightKg?: number | null;
  sizeUnit?: 'm' | 'inch' | 'ft' | null;
  sizeLength?: number | null;
  sizeBreadth?: number | null;
  sizeHeight?: number | null;
}

@Injectable()
export class Co2EstimationService {
  private readonly logger = new Logger(Co2EstimationService.name);
  private readonly apiKey = process.env.CLIMATIQ_API_KEY || '';
  private readonly factorId = process.env.CLIMATIQ_EMISSION_FACTOR_ID || '';
  private readonly endpoint = process.env.CLIMATIQ_API_URL || 'https://beta3.api.climatiq.io/estimate';

  private toCubicMeters(input: Co2Input): number | null {
    const { sizeUnit, sizeLength, sizeBreadth, sizeHeight } = input;
    if (
      !sizeUnit || sizeLength == null || sizeBreadth == null || sizeHeight == null ||
      !isFinite(sizeLength) || !isFinite(sizeBreadth) || !isFinite(sizeHeight)
    ) {
      return null;
    }
    const l = Math.max(0, Number(sizeLength));
    const b = Math.max(0, Number(sizeBreadth));
    const h = Math.max(0, Number(sizeHeight));
    if (!l || !b || !h) return 0;
    const unit = String(sizeUnit).toLowerCase();
    const toMeters = unit === 'm' ? 1 : unit === 'inch' ? 0.0254 : unit === 'ft' ? 0.3048 : 1;
    return l * toMeters * (b * toMeters) * (h * toMeters);
  }

  async estimateSavedCo2Kg(input: Co2Input): Promise<number | null> {
    try {
      // Require API key and factor id to call Climatiq; otherwise return null gracefully
      if (!this.apiKey || !this.factorId) {
        this.logger.debug('CLIMATIQ_API_KEY or CLIMATIQ_EMISSION_FACTOR_ID not set; skipping CO2 estimation');
        return null;
      }

      const weightKg = typeof input.weightKg === 'number' && isFinite(input.weightKg) ? Math.max(0, input.weightKg) : null;
      const volumeM3 = this.toCubicMeters(input);

      // Basic payload uses weight as activity value; include volume metadata when present
      const payload: any = {
        emission_factor: { id: this.factorId },
        parameters: {
          weight: weightKg ?? undefined,
          weight_unit: weightKg != null ? 'kg' : undefined,
          volume: volumeM3 ?? undefined,
          volume_unit: volumeM3 != null ? 'm3' : undefined,
        },
      };

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.warn(`Climatiq estimate failed (${res.status}): ${text}`);
        return null;
      }

      const json: any = await res.json();
      // Common response fields: co2e in kg or co2e_unit; normalize to kg
      const co2e = typeof json.co2e === 'number' ? json.co2e : Number(json?.co2e);
      const unit = (json?.co2e_unit || 'kg').toString().toLowerCase();
      if (!isFinite(co2e)) return null;
      const valueKg = unit === 'g' ? co2e / 1000 : unit === 't' || unit === 'tonne' ? co2e * 1000 : co2e;
      // Treat returned emissions as the avoided emissions (saved) for simplicity
      return Math.max(0, Math.round(valueKg * 100) / 100);
    } catch (err) {
      this.logger.warn(`Climatiq estimation error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

