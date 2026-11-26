import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

export class LogoutDto {
  @ValidateIf((value: LogoutDto) => value.refresh_token !== undefined || value.access_token === undefined)
  @IsString() @IsNotEmpty() @MaxLength(4096)
  refresh_token?: string;

  @ValidateIf((value: LogoutDto) => value.access_token !== undefined || value.refresh_token === undefined)
  @IsString() @IsNotEmpty() @MaxLength(4096)
  access_token?: string;
}
