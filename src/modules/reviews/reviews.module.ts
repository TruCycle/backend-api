import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User } from '../users/user.entity';

import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { UserReview } from './user-review.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserReview, User])],
  controllers: [ReviewsController],
  providers: [ReviewsService, JwtAuthGuard],
  exports: [TypeOrmModule, ReviewsService],
})
export class ReviewsModule {}

