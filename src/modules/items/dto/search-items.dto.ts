import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { ItemStatus } from '../item.entity';

function toNumber(value: any): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toInteger(value: any): number | undefined {
  const num = toNumber(value);
  if (num === undefined) {
    return undefined;
  }
  const intVal = Math.trunc(num);
  return Number.isFinite(intVal) ? intVal : undefined;
}

export class SearchItemsDto {
  @ApiPropertyOptional({ description: 'Latitude in decimal degrees (-90 to 90)' })
  @IsOptional()
  @Transform(({ value }) => toNumber(value))
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Longitude in decimal degrees (-180 to 180)', name: 'lng' })
  @IsOptional()
  @Expose({ name: 'lng' })
  @Transform(({ value }) => toNumber(value))
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({
    description: 'Fallback postcode when lat/lng are omitted (forward geocoded via OpenStreetMap)',
    maxLength: 32,
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  postcode?: string;

  @ApiPropertyOptional({ description: 'Search radius in kilometres', minimum: 0.1, maximum: 50, default: 5 })
  @IsOptional()
  @Transform(({ value }) => toNumber(value))
  @Min(0.1)
  @Max(50)
  radius?: number;

  @ApiPropertyOptional({ enum: ItemStatus, description: 'Filter by item status (defaults to active)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEnum(ItemStatus)
  status?: ItemStatus;

  @ApiPropertyOptional({ description: 'Exact category match (case-insensitive)', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  category?: string;

  @ApiPropertyOptional({ description: 'Requested page (1-indexed)', minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => toInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', minimum: 1, maximum: 50, default: 10 })
  @IsOptional()
  @Transform(({ value }) => toInteger(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
