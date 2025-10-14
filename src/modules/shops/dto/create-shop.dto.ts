import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';
import { IsArray, IsOptional, IsNumber, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class OpeningHoursDto {
  @ApiProperty({ description: 'Days shop is open', type: [String], example: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] })
  @IsArray()
  @IsString({ each: true })
  days!: string[];

  @ApiProperty({ description: 'Opening time (HH:mm)', example: '09:00' })
  @IsString()
  @MaxLength(10)
  open_time!: string;

  @ApiProperty({ description: 'Closing time (HH:mm)', example: '17:00' })
  @IsString()
  @MaxLength(10)
  close_time!: string;
}

export class CreateShopDto {
  @ApiProperty({ description: 'Shop name', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiPropertyOptional({ name: 'phone_number', description: 'Shop contact phone number', maxLength: 32, example: '+44 20 7946 0958' })
  @Expose({ name: 'phone_number' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  phoneNumber?: string;

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

  @ApiPropertyOptional({ description: 'Latitude (WGS84). Ignored when postcode is provided', minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(-90)
  latitude?: number;

  @ApiPropertyOptional({ description: 'Longitude (WGS84). Ignored when postcode is provided', minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(-180)
  longitude?: number;

  @ApiPropertyOptional({ name: 'opening_hours', description: 'Opening days and times', type: OpeningHoursDto })
  @Expose({ name: 'opening_hours' })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpeningHoursDto)
  openingHours?: OpeningHoursDto;

  @ApiPropertyOptional({ name: 'acceptable_categories', description: 'Acceptable item categories', type: [String], example: ['furniture', 'electronics'] })
  @Expose({ name: 'acceptable_categories' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  acceptableCategories?: string[];

  @ApiPropertyOptional({ name: 'operational_notes', description: 'Operational notes or instructions for donors/staff', maxLength: 2000, example: 'Back entrance on Church St. Ring bell.' })
  @Expose({ name: 'operational_notes' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  operationalNotes?: string;
}
