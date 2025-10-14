import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GeoModule } from '../../geo/geo.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User } from '../users/user.entity';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import { ShopsController } from './shops.controller';
import { Shop } from './shop.entity';
import { ShopsService } from './shops.service';
import { Item } from '../items/item.entity';
import { Claim } from '../claims/claim.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Shop, User, Item, Claim]), GeoModule],
  controllers: [ShopsController],
  providers: [ShopsService, JwtAuthGuard, ItemGeocodingService],
})
export class ShopsModule {}
