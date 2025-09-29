import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Claim } from '../claims/claim.entity';
import { QrModule } from '../qr/qr.module';
import { UserReview } from '../reviews/user-review.entity';
import { KycProfile } from '../users/kyc-profile.entity';
import { User } from '../users/user.entity';

import { Co2EstimationService } from './co2-estimation.service';
import { ItemGeocodingService } from './item-geocoding.service';
import { Item } from './item.entity';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [TypeOrmModule.forFeature([Item, Claim, User, KycProfile, UserReview]), QrModule],
  controllers: [ItemsController],
  providers: [ItemsService, ItemGeocodingService, Co2EstimationService, JwtAuthGuard],
  exports: [TypeOrmModule, ItemsService],
})
export class ItemsModule {}
