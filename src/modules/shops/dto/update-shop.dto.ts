import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { OpeningHoursDto } from './create-shop.dto';

export class UpdateShopDto {
  @ApiPropertyOptional({ description: 'Shop name', minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiPropertyOptional({ name: 'phone_number', description: 'Shop contact phone number', maxLength: 32 })
  @Expose({ name: 'phone_number' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  phoneNumber?: string;

  @ApiPropertyOptional({ name: 'address_line', description: 'Street address or landmark', maxLength: 255 })
  @Expose({ name: 'address_line' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  addressLine?: string;

  @ApiPropertyOptional({ description: 'Postal code', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  postcode?: string;

  @ApiPropertyOptional({ description: 'Latitude (WGS84)', minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(-90)
  latitude?: number;

  @ApiPropertyOptional({ description: 'Longitude (WGS84)', minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(-180)
  longitude?: number;

  @ApiPropertyOptional({ description: 'Active flag' })
  @IsOptional()
  active?: boolean;

  @ApiPropertyOptional({ name: 'opening_hours', description: 'Opening days and times', type: OpeningHoursDto })
  @Expose({ name: 'opening_hours' })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpeningHoursDto)
  openingHours?: OpeningHoursDto;

  @ApiPropertyOptional({ name: 'acceptable_categories', description: 'Acceptable item categories', type: [String] })
  @Expose({ name: 'acceptable_categories' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  acceptableCategories?: string[];

  @ApiPropertyOptional({ name: 'operational_notes', description: 'Operational notes or instructions for donors/staff', maxLength: 2000 })
  @Expose({ name: 'operational_notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  operationalNotes?: string;
}
