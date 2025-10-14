import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ name: 'first_name', description: 'First name', maxLength: 100 })
  @Expose({ name: 'first_name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  firstName?: string | null;

  @ApiPropertyOptional({ name: 'last_name', description: 'Last name', maxLength: 100 })
  @Expose({ name: 'last_name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  lastName?: string | null;

  @ApiPropertyOptional({ description: 'Phone number', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  phone?: string | null;

  @ApiPropertyOptional({ description: 'Postcode', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  postcode?: string | null;
}
