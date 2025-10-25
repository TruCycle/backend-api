import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListNotificationsQueryDto {
  @IsOptional()
  @IsBooleanString()
  unread?: string; // 'true' | 'false'

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

