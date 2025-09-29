import { ApiProperty } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsUrl, MaxLength } from 'class-validator';

export class UpdateProfileImageDto {
  @ApiProperty({ name: 'profile_image_url', description: 'Public image URL', format: 'uri' })
  @Expose({ name: 'profile_image_url' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  profileImageUrl!: string;
}

