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

// Missing query parameters stay optional; supplied malformed values must reach
// validation rather than disappearing and widening an intended nearby search.
function toNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return Number(value.trim());
  return NaN;
}

function toInteger(value: unknown): number | undefined {
  return toNumber(value);
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
    description: 'Postcode to search near. If provided, it overrides lat/lng (forward geocoded via OpenStreetMap).',
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
