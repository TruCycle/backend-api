import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { Item } from './item.entity';
import { User } from '../users/user.entity';
import { ServiceZone } from '../addresses/service-zone.entity';
import { ItemGeocodingService } from './item-geocoding.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Item, User, ServiceZone])],
  controllers: [ItemsController],
  providers: [ItemsService, ItemGeocodingService, JwtAuthGuard],
  exports: [TypeOrmModule, ItemsService],
})
export class ItemsModule {}
