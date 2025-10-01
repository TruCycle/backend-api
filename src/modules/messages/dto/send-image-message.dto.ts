import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SendImageMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  caption?: string;
}
