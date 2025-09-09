import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const allowedContentTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export class PresignPhotoDto {
  @ApiProperty({ enum: allowedContentTypes })
  @IsString()
  @IsIn(allowedContentTypes)
  contentType!: string;

  @ApiProperty({ required: false, default: 8, description: 'Max size in MB (1-20)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxSizeMB?: number = 8;
}

export const AllowedPhotoContentTypes = allowedContentTypes;

