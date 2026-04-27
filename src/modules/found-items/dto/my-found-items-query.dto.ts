import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { FoundItemStatus } from '../found-item.entity';

export class MyFoundItemsQueryDto {
  @ApiPropertyOptional({ enum: FoundItemStatus })
  @IsOptional()
  @IsEnum(FoundItemStatus)
  status?: FoundItemStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
