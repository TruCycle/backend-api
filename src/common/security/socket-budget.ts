import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { performance } from 'node:perf_hooks';

import { releaseLogFields } from '../utils/safe-log';
import { optionalLimit, TokenBucket } from './token-bucket';

class SocketBudget {
  private readonly logger = new Logger('SocketBudget');
  private readonly lastLogged = new Map<string, number>();
  private readonly connectionsPerMinute = optionalLimit('SOCKET_CONNECTIONS_PER_MINUTE');
  private readonly concurrentAuthentications = optionalLimit('SOCKET_MAX_CONCURRENT_AUTH');
  private readonly packetsPerMinute = optionalLimit('SOCKET_PACKETS_PER_MINUTE');
  private readonly connections = this.connectionsPerMinute ? new TokenBucket(this.connectionsPerMinute) : undefined;
  private inFlight = 0;

  async authenticate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.concurrentAuthentications !== undefined && this.inFlight >= this.concurrentAuthentications) {
      this.report('auth_concurrency');
      throw new ServiceUnavailableException('Socket authentication temporarily unavailable');
    }
    if (this.connections && !this.connections.take()) {
      this.report('connection_rate');
      throw new ServiceUnavailableException('Socket authentication temporarily unavailable');
    }
    this.inFlight++;
    try {
      return await operation();
    } finally {
      this.inFlight--;
    }
  }

  packetBudget(): (() => boolean) | undefined {
    if (this.packetsPerMinute === undefined) return undefined;
    const bucket = new TokenBucket(this.packetsPerMinute);
    return () => {
      if (bucket.take()) return true;
      this.report('packet_rate');
      return false;
    };
  }

  private report(reason: 'auth_concurrency' | 'connection_rate' | 'packet_rate'): void {
    const now = performance.now();
    const last = this.lastLogged.get(reason);
    if (last !== undefined && now - last < 60_000) return;
    this.lastLogged.set(reason, now);
    this.logger.warn(JSON.stringify({ event: 'socket_budget', outcome: 'limited', reason, ...releaseLogFields() }));
  }
}

let sharedBudget: SocketBudget | undefined;

export function socketBudget(): SocketBudget {
  // Both gateways share the same capacity within each API process.
  return sharedBudget ??= new SocketBudget();
}
