import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { FOUND_ITEM_CATEGORIES } from './create-found-item.dto';
import { FoundItemStatus } from '../found-item.entity';

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toInteger(value: unknown): number | undefined {
  const parsed = toNumber(value);
  return parsed === undefined ? undefined : Math.trunc(parsed);
}

export enum FoundItemSortBy {
  NEWEST = 'newest',
  NEAREST = 'nearest',
  POPULAR = 'popular',
}

export class SearchFoundItemsDto {
  @ApiPropertyOptional({ enum: FOUND_ITEM_CATEGORIES })
  @IsOptional()
  @IsIn(FOUND_ITEM_CATEGORIES)
  category?: (typeof FOUND_ITEM_CATEGORIES)[number];

  @ApiPropertyOptional({ enum: FoundItemStatus })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEnum(FoundItemStatus)
  status?: FoundItemStatus;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  postcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => toNumber(value))
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ name: 'lng' })
  @IsOptional()
  @Expose({ name: 'lng' })
  @Transform(({ value }) => toNumber(value))
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ minimum: 0.1, maximum: 50, default: 5 })
  @IsOptional()
  @Transform(({ value }) => toNumber(value))
  @Min(0.1)
  @Max(50)
  maxDistance?: number;

  @ApiPropertyOptional({ enum: FoundItemSortBy, default: FoundItemSortBy.NEWEST })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEnum(FoundItemSortBy)
  sortBy?: FoundItemSortBy;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 1 })
  @IsOptional()
  @Transform(({ value }) => toInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Transform(({ value }) => toInteger(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
