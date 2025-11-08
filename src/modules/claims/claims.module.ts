import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Item } from '../items/item.entity';
import { User } from '../users/user.entity';

import { Claim } from './claim.entity';
import { ClaimsController } from './claims.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { Shop } from '../shops/shop.entity';
import { ClaimsService } from './claims.service';
import { RewardsModule } from '../rewards/rewards.module';

@Module({
  imports: [TypeOrmModule.forFeature([Claim, Item, User, Shop]), forwardRef(() => NotificationsModule), RewardsModule],
  controllers: [ClaimsController],
  providers: [ClaimsService, JwtAuthGuard],
  exports: [ClaimsService],
})
export class ClaimsModule {}
