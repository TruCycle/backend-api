import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: 'Email verification token (JWT)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token!: string;
}
