import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GamificationModule } from '../gamification/gamification.module';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/user.entity';

import { FoundItemClaim } from './found-item-claim.entity';
import { FoundItemObservation } from './found-item-observation.entity';
import { FoundItemReport } from './found-item-report.entity';
import { FoundItem } from './found-item.entity';
import { FoundItemsController } from './found-items.controller';
import { FoundItemsService } from './found-items.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FoundItem, FoundItemClaim, FoundItemReport, FoundItemObservation, User]),
    NotificationsModule,
    GamificationModule,
  ],
  controllers: [FoundItemsController],
  providers: [FoundItemsService, ItemGeocodingService, JwtAuthGuard],
  exports: [FoundItemsService],
})
export class FoundItemsModule {}
