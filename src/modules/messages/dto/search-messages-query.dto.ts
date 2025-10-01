import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SearchMessagesQueryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  query!: string;
}
