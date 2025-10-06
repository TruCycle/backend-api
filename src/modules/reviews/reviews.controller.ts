import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

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
  @ApiBody({ description: 'Review payload', type: CreateReviewDto })
  @ApiOkResponse({
    description: 'Created review',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: { id: 'review-id', created_at: '2024-06-01T12:00:00.000Z' },
      },
    },
  })
  async create(@Body() dto: CreateReviewDto, @Req() req: any) {
    const userId = req?.user?.sub;
    return this.reviews.create(userId, dto);
  }

  @Get('users/:id/reviews')
  @ApiOperation({ summary: 'List reviews and aggregate rating for a user' })
  @ApiOkResponse({
    description: 'Reviews list and aggregates',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          rating: 4.8,
          reviews_count: 12,
          reviews: [
            {
              id: 'r1',
              rating: 5,
              comment: 'Nice',
              reviewer: { id: 'user-id', name: 'Jane Doe' },
              created_at: '2024-06-01T10:00:00.000Z',
            },
          ],
        },
      },
    },
  })
  async list(@Param('id') id: string) {
    return this.reviews.listForUser(id);
  }
}
