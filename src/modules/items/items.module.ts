import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ServiceZone } from '../addresses/service-zone.entity';
import { Address } from '../addresses/address.entity';
import { User } from '../users/user.entity';
import { KycProfile } from '../users/kyc-profile.entity';
import { UserReview } from '../reviews/user-review.entity';

import { ItemGeocodingService } from './item-geocoding.service';
import { Item } from './item.entity';
import { ItemsController } from './items.controller';
import { QrModule } from '../qr/qr.module';
import { ItemsService } from './items.service';



@Module({
  imports: [TypeOrmModule.forFeature([Item, User, ServiceZone, Address, KycProfile, UserReview]), QrModule],
  controllers: [ItemsController],
  providers: [ItemsService, ItemGeocodingService, JwtAuthGuard],
  exports: [TypeOrmModule, ItemsService],
})
export class ItemsModule {}
