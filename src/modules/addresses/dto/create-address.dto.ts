import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateAddressDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  line1?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  line2?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ required: false, description: 'Postal code (UK postcode when in London)', example: 'NW1 6XE' })
  @IsOptional()
  @IsString()
  postcode?: string;

  @ApiProperty({ description: 'Latitude in WGS84', example: 51.5074 })
  @IsNumber()
  latitude!: number;

  @ApiProperty({ description: 'Longitude in WGS84', example: -0.1278 })
  @IsNumber()
  longitude!: number;

  @ApiProperty({ required: false, description: 'Whether this is the default address. Also accepts `is_default` alias.' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value, obj }) => (typeof obj?.is_default === 'boolean' ? obj.is_default : value))
  isDefault?: boolean;
}
