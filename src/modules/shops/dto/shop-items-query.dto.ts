import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { ItemPickupOption, ItemStatus } from '../../items/item.entity';

function toInteger(value: any): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.trunc(n);
  return Number.isFinite(i) ? i : undefined;
}

export class ShopItemsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by item status', enum: ItemStatus })
  @IsOptional()
  @IsEnum(ItemStatus)
  status?: ItemStatus;

  @ApiPropertyOptional({ description: 'Filter by pickup option', enum: ItemPickupOption })
  @IsOptional()
  @IsEnum(ItemPickupOption)
  pickup_option?: ItemPickupOption;

  @ApiPropertyOptional({ description: 'Exact category match (case-insensitive)', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  category?: string;

  @ApiPropertyOptional({ description: 'Created at from (ISO8601)' })
  @IsOptional()
  @Expose({ name: 'created_from' })
  created_from?: string;

  @ApiPropertyOptional({ description: 'Created at to (ISO8601)' })
  @IsOptional()
  @Expose({ name: 'created_to' })
  created_to?: string;

  @ApiPropertyOptional({ description: 'Results per page', minimum: 1, maximum: 50, default: 10 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'Page number', minimum: 1, maximum: 100, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number;
}

