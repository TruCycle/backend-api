import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum } from 'class-validator';

import { FoundItemStatus } from '../found-item.entity';

export class UpdateFoundItemStatusDto {
  @ApiProperty({ enum: FoundItemStatus })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEnum(FoundItemStatus)
  status!: FoundItemStatus;
}
