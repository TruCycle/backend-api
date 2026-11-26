import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DirectMessageDto {
  @ApiProperty({ format: 'uuid', description: 'Stable client-generated UUID reused when retrying this exact message' })
  @IsUUID('4')
  clientMessageId!: string;

  @ApiProperty({ maxLength: 4000 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;
}
