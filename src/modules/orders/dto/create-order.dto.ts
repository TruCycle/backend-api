import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreatePickupItemDto {
  @ApiProperty({ description: 'Material type identifier/code' })
  @IsString()
  @IsNotEmpty()
  material_id!: string;

  @ApiProperty({ required: false, description: 'Category code path, e.g., electronics.household' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ description: 'Quantity of items', example: 2 })
  @IsNumber()
  @Min(0.0001)
  qty!: number;

  @ApiProperty({ required: false, enum: ['great', 'good', 'bad', 'repairable'] })
  @IsOptional()
  @IsString()
  status?: 'great' | 'good' | 'bad' | 'repairable';

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => {
    if (value == null) return undefined;
    if (Array.isArray(value)) return value.map(String);
    return [String(value)];
  })
  photos?: string[];

  @ApiProperty({ required: false, description: 'Arbitrary metadata for WEEE items' })
  @IsOptional()
  weee_data?: Record<string, any>;
}

export class CreatePickupOrderDto {
  @ApiProperty({ description: "User's saved origin address id" })
  @IsUUID()
  origin_address_id!: string;

  @ApiProperty({ required: false, description: 'Additional pickup notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [CreatePickupItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePickupItemDto)
  items!: CreatePickupItemDto[];
}

