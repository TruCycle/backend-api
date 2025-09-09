import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Address } from './address.entity';
import { ServiceZone } from './service-zone.entity';
import { AddressesService } from './addresses.service';
import { AddressesController } from './addresses.controller';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Address, ServiceZone, User])],
  controllers: [AddressesController],
  providers: [AddressesService],
  exports: [TypeOrmModule, AddressesService],
})
export class AddressesModule {}
