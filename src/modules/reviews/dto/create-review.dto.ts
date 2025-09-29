import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ name: 'target_user_id', format: 'uuid' })
  @Expose({ name: 'target_user_id' })
  @IsUUID()
  targetUserId!: string;

  @ApiProperty({ description: 'Rating between 0.0 and 5.0', minimum: 0, maximum: 5 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ description: 'Optional short comment', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  comment?: string;
}

