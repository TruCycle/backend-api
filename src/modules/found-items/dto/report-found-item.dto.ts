import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export const FOUND_ITEM_REPORT_REASONS = ['already_gone', 'not_there', 'unsafe', 'misleading', 'duplicate', 'other'] as const;

export class ReportFoundItemDto {
  @ApiPropertyOptional() @IsOptional() @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() longitude?: number;
  @ApiProperty({ enum: FOUND_ITEM_REPORT_REASONS })
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsIn(FOUND_ITEM_REPORT_REASONS)
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  details?: string;
}
