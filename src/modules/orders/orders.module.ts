import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Address } from '../addresses/address.entity';
import { ServiceZone } from '../addresses/service-zone.entity';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/user.entity';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PickupItem } from './pickup-item.entity';
import { PickupOrder } from './pickup-order.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PickupOrder, PickupItem, Address, ServiceZone, User]), AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [TypeOrmModule, OrdersService],
})
export class OrdersModule {}
