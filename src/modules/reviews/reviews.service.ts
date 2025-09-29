import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../users/user.entity';

import { CreateReviewDto } from './dto/create-review.dto';
import { UserReview } from './user-review.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(UserReview) private readonly reviews: Repository<UserReview>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async create(reviewerId: string, dto: CreateReviewDto) {
    if (reviewerId === dto.targetUserId) {
      throw new BadRequestException('You cannot review yourself');
    }
    const reviewer = await this.users.findOne({ where: { id: reviewerId } });
    if (!reviewer) throw new NotFoundException('Reviewer not found');
    const target = await this.users.findOne({ where: { id: dto.targetUserId } });
    if (!target) throw new NotFoundException('Target user not found');

    const existing = await this.reviews.findOne({
      where: { reviewerUser: { id: reviewerId }, targetUser: { id: dto.targetUserId } },
      relations: { reviewerUser: true, targetUser: true },
    });
    if (existing) {
      throw new ForbiddenException('You have already reviewed this user');
    }

    const entity = this.reviews.create({
      reviewerUser: reviewer,
      targetUser: target,
      rating: dto.rating.toFixed(1),
      comment: dto.comment ?? null,
    });
    const saved = await this.reviews.save(entity);
    return { id: saved.id, created_at: saved.createdAt.toISOString() };
  }

  async listForUser(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const reviews = await this.reviews.find({
      where: { targetUser: { id: userId } },
      relations: { reviewerUser: true },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    const aggregate = await this.reviews
      .createQueryBuilder('r')
      .select('r.target_user_id', 'target_user_id')
      .addSelect('AVG(r.rating)::float', 'avg_rating')
      .addSelect('COUNT(1)', 'reviews_count')
      .where('r.target_user_id = :userId', { userId })
      .groupBy('r.target_user_id')
      .getRawOne<{ avg_rating: number; reviews_count: string }>();

    const rating = aggregate ? Number(aggregate.avg_rating) : 0;
    const reviewsCount = aggregate ? Number(aggregate.reviews_count) : 0;

    return {
      rating: Math.round(rating * 10) / 10,
      reviews_count: reviewsCount,
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: parseFloat(r.rating as unknown as string),
        comment: r.comment ?? null,
        reviewer: {
          id: r.reviewerUser.id,
          name: [r.reviewerUser.firstName, r.reviewerUser.lastName].filter(Boolean).join(' ').trim() ||
            (typeof r.reviewerUser.email === 'string' ? r.reviewerUser.email.split('@')[0] : ''),
        },
        created_at: r.createdAt.toISOString(),
      })),
    };
  }
}

