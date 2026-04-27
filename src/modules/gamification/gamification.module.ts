import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Claim } from '../claims/claim.entity';
import { FoundItem } from '../found-items/found-item.entity';
import { FoundItemClaim } from '../found-items/found-item-claim.entity';
import { Item } from '../items/item.entity';
import { User } from '../users/user.entity';
import { GamificationBadge } from './badge.entity';
import { PointTransaction } from './point-transaction.entity';
import { UserBadge } from './user-badge.entity';
import { UserProgress } from './user-progress.entity';
import { UserStreak } from './user-streak.entity';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Claim,
      Item,
      FoundItem,
      FoundItemClaim,
      UserProgress,
      UserStreak,
      GamificationBadge,
      UserBadge,
      PointTransaction,
    ]),
  ],
  controllers: [GamificationController],
  providers: [GamificationService, JwtAuthGuard],
  exports: [GamificationService],
})
export class GamificationModule {}
