import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class GeneralMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}
