import { ApiProperty } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsUUID } from 'class-validator';

export class CreateClaimDto {
  @ApiProperty({ name: 'item_id', description: 'UUID of the item being claimed' })
  @Expose({ name: 'item_id' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsUUID()
  itemId!: string;
}
