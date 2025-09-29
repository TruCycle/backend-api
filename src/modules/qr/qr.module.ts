import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Claim } from '../claims/claim.entity';
import { ClaimsModule } from '../claims/claims.module';
import { Item } from '../items/item.entity';
import { User } from '../users/user.entity';

import { QrImageService } from './qr-image.service';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';
@Module({
  imports: [ClaimsModule, TypeOrmModule.forFeature([Claim, Item, User])],
  controllers: [QrController],
  providers: [JwtAuthGuard, QrService, QrImageService],
  exports: [QrImageService],
})
export class QrModule {}
