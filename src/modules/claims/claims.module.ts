import { Module } from '@nestjs/common';

import { ClaimsController } from './claims.controller';

@Module({ controllers: [ClaimsController] })
export class ClaimsModule {}
