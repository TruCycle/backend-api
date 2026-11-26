import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { registeredMigrationNames } from '../../database/migration-registry';

import { checkReadiness } from './readiness';

@ApiTags('health')
@Controller('health')
export class ReadinessController {
  constructor(@InjectDataSource() private readonly database: DataSource) {}

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: database reachable and all migrations applied' })
  async ready() {
    const ready = await checkReadiness((sql) => this.database.query(sql), registeredMigrationNames);
    // No detail in the body: this route is public.
    if (!ready) throw new ServiceUnavailableException('Not ready');
    return { ready: true };
  }
}
