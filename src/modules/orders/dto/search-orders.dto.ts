import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class SearchOrdersDto {
  @ApiPropertyOptional({ description: "User's current latitude", example: 51.5072 })
  @IsNumber()
  lat!: number;

  @ApiPropertyOptional({ description: "User's current longitude", example: -0.1276 })
  @IsNumber()
  lon!: number;

  @ApiPropertyOptional({ description: 'Search radius. Defaults to 10 (km).', example: 10 })
  @IsOptional()
  @IsNumber()
  distance?: number;

  @ApiPropertyOptional({ description: 'Unit for distance: km or mi', example: 'km', default: 'km' })
  @IsOptional()
  @IsString()
  @IsIn(['km', 'mi'])
  unit?: 'km' | 'mi';

  @ApiPropertyOptional({ description: 'Category prefix filter (e.g., electronics)', example: 'electronics' })
  @IsOptional()
  @IsString()
  category?: string;
}

