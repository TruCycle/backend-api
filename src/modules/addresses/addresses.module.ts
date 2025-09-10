import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Address } from './address.entity';
import { ServiceZone } from './service-zone.entity';
import { AddressesService } from './addresses.service';
import { AddressesController } from './addresses.controller';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Address, ServiceZone, User]), AuthModule],
  controllers: [AddressesController],
  providers: [AddressesService],
  exports: [TypeOrmModule, AddressesService],
})
export class AddressesModule {}
