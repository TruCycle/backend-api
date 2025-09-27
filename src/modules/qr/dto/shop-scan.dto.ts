import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class ShopScanDto {
  @ApiProperty({ name: 'shop_id', description: 'Identifier of the shop where the scan occurred' })
  @Expose({ name: 'shop_id' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  shopId!: string;
}

export class DropoffScanDto extends ShopScanDto {
  @ApiProperty({ enum: ['accept', 'reject'], default: 'accept' })
  @Expose({ name: 'action' })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'accept',
  )
  @IsString()
  @IsIn(['accept', 'reject'])
  action!: 'accept' | 'reject';

  @ApiPropertyOptional({ description: 'Reason provided when rejecting a donor drop-off' })
  @Expose({ name: 'reason' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((dto: DropoffScanDto) => dto.action === 'reject')
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  reason?: string;
}
