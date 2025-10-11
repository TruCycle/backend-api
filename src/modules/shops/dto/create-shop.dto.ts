import { ApiProperty } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateShopDto {
  @ApiProperty({ description: 'Shop name', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiProperty({ name: 'address_line', description: 'Street address or landmark', maxLength: 255 })
  @Expose({ name: 'address_line' })
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  addressLine!: string;

  @ApiProperty({ description: 'Postal code', maxLength: 32 })
  @IsString()
  @MaxLength(32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  postcode!: string;

  @ApiProperty({ description: 'Latitude (WGS84)', minimum: -90, maximum: 90 })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(-90)
  latitude!: number;

  @ApiProperty({ description: 'Longitude (WGS84)', minimum: -180, maximum: 180 })
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(-180)
  longitude!: number;
}

