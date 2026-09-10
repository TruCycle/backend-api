import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({
    description:
      'The Google ID token (JWT) returned by Google Identity Services on the client.',
  })
  @IsString()
  @MinLength(20)
  id_token!: string;
}
