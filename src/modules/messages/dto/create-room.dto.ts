import { IsUUID } from 'class-validator';

export class CreateRoomDto {
  @IsUUID()
  otherUserId!: string;
}
