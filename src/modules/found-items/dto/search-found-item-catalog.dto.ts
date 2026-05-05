import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { FOUND_ITEM_CATEGORIES } from './create-found-item.dto';

function toInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : undefined;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
  }

  return undefined;
}

export class SearchFoundItemCatalogDto {
  @ApiPropertyOptional({ enum: FOUND_ITEM_CATEGORIES })
  @IsOptional()
  @IsIn(FOUND_ITEM_CATEGORIES)
  category?: (typeof FOUND_ITEM_CATEGORIES)[number];

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 8 })
  @IsOptional()
  @Transform(({ value }) => toInteger(value))
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}