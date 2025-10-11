import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GeoModule } from '../../geo/geo.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User } from '../users/user.entity';
import { ShopsController } from './shops.controller';
import { Shop } from './shop.entity';
import { ShopsService } from './shops.service';

@Module({
  imports: [TypeOrmModule.forFeature([Shop, User]), GeoModule],
  controllers: [ShopsController],
  providers: [ShopsService, JwtAuthGuard],
})
export class ShopsModule {}

