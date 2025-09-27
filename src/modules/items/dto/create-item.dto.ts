import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { ItemCondition, ItemPickupOption } from '../item.entity';

export class CreateItemImageDto {
  @ApiProperty({ description: 'Publicly accessible image URL', format: 'uri' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  url!: string;

  @ApiPropertyOptional({ description: 'Short alt text to improve accessibility', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  altText?: string;
}

export class CreateItemDto {
  @ApiProperty({ description: 'Listing title', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title!: string;

  @ApiPropertyOptional({ description: 'Detailed item description', maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description?: string;

  @ApiProperty({ enum: ItemCondition, description: 'Declared physical condition' })
  @IsEnum(ItemCondition)
  condition!: ItemCondition;

  @ApiProperty({ description: 'High-level category label', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  category!: string;

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

  @ApiPropertyOptional({
    type: [CreateItemImageDto],
    description: 'Optional list of hosted images (max 10)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateItemImageDto)
  images?: CreateItemImageDto[];

  @ApiProperty({
    name: 'pickup_option',
    enum: ItemPickupOption,
    description: 'Defines the fulfilment flow (donate | exchange | recycle)',
  })
  @Expose({ name: 'pickup_option' })
  @IsEnum(ItemPickupOption)
  pickupOption!: ItemPickupOption;

  @ApiPropertyOptional({
    name: 'dropoff_location_id',
    format: 'uuid',
    description: 'Shop or hub identifier when scheduling a drop-off',
  })
  @Expose({ name: 'dropoff_location_id' })
  @IsOptional()
  @IsUUID()
  dropoffLocationId?: string;

  @ApiPropertyOptional({
    name: 'delivery_preferences',
    description: 'Free-form preferences such as availability or notes',
    maxLength: 240,
  })
  @Expose({ name: 'delivery_preferences' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  deliveryPreferences?: string;

  @ApiPropertyOptional({
    description: 'Additional structured attributes (weight, dimensions, etc.)',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  @Transform(({ value }) => (value && typeof value === 'object' ? value : undefined))
  metadata?: Record<string, any>;
}
