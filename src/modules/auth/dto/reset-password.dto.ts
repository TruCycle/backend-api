import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: 'Password reset token (JWT)' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'new-StrongP@ssw0rd', minLength: 8 })
  @IsString()
  @MinLength(8)
  new_password!: string;
}
