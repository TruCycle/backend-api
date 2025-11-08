import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';
import { LedgerEntry } from './ledger-entry.entity';
import { Wallet } from './wallet.entity';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, LedgerEntry, User])],
  controllers: [RewardsController],
  providers: [RewardsService, JwtAuthGuard],
  exports: [RewardsService],
})
export class RewardsModule {}

