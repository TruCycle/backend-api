import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsLatitude, IsLongitude, IsOptional } from 'class-validator';
export class ObserveFoundItemDto {
  @ApiProperty({ enum: ['still_there', 'gone'] })
  @IsIn(['still_there', 'gone']) kind!: 'still_there' | 'gone';
  @ApiPropertyOptional({ description: 'Self-attested search origin; not stored or proof of physical presence' })
  @IsOptional() @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() longitude?: number;
}
