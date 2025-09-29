import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { ClaimStatus } from '../../claims/claim.entity';
import { ItemStatus } from '../item.entity';

export class UserItemsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by item status', enum: ItemStatus })
  @IsOptional()
  @IsEnum(ItemStatus)
  status?: ItemStatus;

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

export class UserCollectedItemsQueryDto extends UserItemsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by claim status', enum: ClaimStatus })
  @IsOptional()
  @IsEnum(ClaimStatus)
  claim_status?: ClaimStatus;
}
