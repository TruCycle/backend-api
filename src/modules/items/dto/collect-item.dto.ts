import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CollectItemDto {
  @ApiPropertyOptional({ name: 'shop_id', description: 'Shop identifier for donation drop-offs (required if item has a drop-off location)' })
  @Expose({ name: 'shop_id' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  shopId?: string;
}

