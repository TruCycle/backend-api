import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { releaseLogFields } from '../../common/utils/safe-log';
import { FoundItemsService } from './found-items.service';

const intervalMs = 5 * 60_000;

@Injectable()
export class FoundItemsLifecycleScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FoundItemsLifecycleScheduler.name);
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;

  constructor(private readonly foundItems: FoundItemsService) {}

  onModuleInit(): void {
    if (process.env.FOUND_ITEM_LIFECYCLE_SWEEP_ENABLED === 'true') this.schedule();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.run().finally(() => this.schedule());
    }, intervalMs);
    this.timer.unref();
  }

  private async run(): Promise<void> {
    try {
      const counts = await this.foundItems.processLifecycle();
      const event = 'found_item_lifecycle_sweep';
      if (counts.failed) this.logger.warn(JSON.stringify({ event, outcome: 'candidate_failures', ...counts, ...releaseLogFields() }));
      else if (counts.nudged || counts.expired) this.logger.log(JSON.stringify({ event, outcome: 'completed', ...counts, ...releaseLogFields() }));
    } catch {
      this.logger.warn(JSON.stringify({ event: 'found_item_lifecycle_sweep', outcome: 'failed', ...releaseLogFields() }));
    }
  }
}
