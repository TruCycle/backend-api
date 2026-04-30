import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export const communityBoardWindows = ['week', 'month', 'all'] as const;

export type CommunityBoardWindow = (typeof communityBoardWindows)[number];

export class CommunityBoardQueryDto {
  @ApiPropertyOptional({ enum: communityBoardWindows, default: 'month' })
  @IsOptional()
  @IsEnum(communityBoardWindows)
  window?: CommunityBoardWindow;
}