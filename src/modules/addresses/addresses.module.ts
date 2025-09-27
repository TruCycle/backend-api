import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { User } from '../users/user.entity';

import { Address } from './address.entity';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { ServiceZone } from './service-zone.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Address, ServiceZone, User]), AuthModule],
  controllers: [AddressesController],
  providers: [AddressesService],
  exports: [TypeOrmModule, AddressesService],
})
export class AddressesModule {}
