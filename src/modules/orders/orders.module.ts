import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PickupOrder } from './pickup-order.entity';
import { PickupItem } from './pickup-item.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { Address } from '../addresses/address.entity';
import { ServiceZone } from '../addresses/service-zone.entity';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([PickupOrder, PickupItem, Address, ServiceZone, User]), AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [TypeOrmModule, OrdersService],
})
export class OrdersModule {}
