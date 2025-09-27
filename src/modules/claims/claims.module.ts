import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Item } from '../items/item.entity';
import { User } from '../users/user.entity';

import { Claim } from './claim.entity';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

@Module({
  imports: [TypeOrmModule.forFeature([Claim, Item, User])],
  controllers: [ClaimsController],
  providers: [ClaimsService, JwtAuthGuard],
})
export class ClaimsModule {}
