import { performance } from 'node:perf_hooks';

export function optionalLimit(name: string): number | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  const limit = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000) {
    throw new Error(`${name} must be a positive integer no greater than 1000000`);
  }
  return limit;
}

export class TokenBucket {
  private tokens: number;
  private updatedAt = performance.now();

  constructor(private readonly capacity: number) {
    this.tokens = capacity;
  }

  take(): boolean {
    const now = performance.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.updatedAt) * this.capacity / 60_000);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}
