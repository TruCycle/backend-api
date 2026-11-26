import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendImageMessageDto {
  @IsUUID('4')
  clientMessageId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  caption?: string;
}
