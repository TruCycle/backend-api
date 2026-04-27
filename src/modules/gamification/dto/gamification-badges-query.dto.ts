import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';

import { GamificationBadgeCategory } from '../badge.entity';

export enum GamificationBadgeFilter {
  ALL = 'all',
  EARNED = 'earned',
  AVAILABLE = 'available',
}

export class GamificationBadgesQueryDto {
  @ApiPropertyOptional({ enum: GamificationBadgeFilter, default: GamificationBadgeFilter.ALL })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEnum(GamificationBadgeFilter)
  filter?: GamificationBadgeFilter;

  @ApiPropertyOptional({ enum: GamificationBadgeCategory })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEnum(GamificationBadgeCategory)
  category?: GamificationBadgeCategory;
}
