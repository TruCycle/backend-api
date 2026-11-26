import { Transform } from 'class-transformer';
import { IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class SendNotificationDto {
  @IsUUID()
  userId!: string;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 120)
  template!: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
