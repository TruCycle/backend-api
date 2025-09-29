import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('reviews')
  @ApiOperation({ summary: 'Create a review for a user' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateReviewDto, @Req() req: any) {
    const userId = req?.user?.sub;
    return this.reviews.create(userId, dto);
  }

  @Get('users/:id/reviews')
  @ApiOperation({ summary: 'List reviews and aggregate rating for a user' })
  async list(@Param('id') id: string) {
    return this.reviews.listForUser(id);
  }
}

