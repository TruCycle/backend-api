import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export const FOUND_ITEM_REPORT_REASONS = ['already_gone', 'not_there', 'unsafe', 'misleading', 'duplicate', 'other'] as const;

const isKnownReason = (value: unknown): boolean =>
  typeof value === 'string' && (FOUND_ITEM_REPORT_REASONS as readonly string[]).includes(value.trim());

// Clients released before the fixed reason list send free text. Keep accepting it:
// file it under 'other' and preserve the text as details.
export function normalizeReportReason(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed && !isKnownReason(trimmed) ? 'other' : trimmed;
}

export function normalizeReportDetails(details: unknown, reason: unknown): unknown {
  const text = typeof details === 'string' ? details.trim() : details;
  if (text || isKnownReason(reason) || typeof reason !== 'string' || !reason.trim()) return text;
  return reason.trim().slice(0, 1000);
}

export class ReportFoundItemDto {
  @ApiPropertyOptional() @IsOptional() @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() longitude?: number;
  @ApiProperty({ enum: FOUND_ITEM_REPORT_REASONS })
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => normalizeReportReason(value))
  @IsIn(FOUND_ITEM_REPORT_REASONS)
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Expose()
  @Transform(({ value, obj }) => normalizeReportDetails(value, obj?.reason))
  details?: string;
}
