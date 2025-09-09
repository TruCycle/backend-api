import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PickupOrder } from './pickup-order.entity';
import { PickupItem } from './pickup-item.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PickupOrder, PickupItem])],
  controllers: [],
  providers: [],
  exports: [TypeOrmModule],
})
export class OrdersModule {}

