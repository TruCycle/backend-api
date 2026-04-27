import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GamificationBadgesQueryDto } from './dto/gamification-badges-query.dto';
import { PointHistoryQueryDto } from './dto/point-history-query.dto';
import { GamificationService } from './gamification.service';

@ApiTags('gamification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('gamification')
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  @Get('progress')
  @ApiOperation({ summary: 'Get gamification progress for the authenticated user' })
  @ApiOkResponse({ description: 'Progress summary' })
  async getProgress(@Req() req: any): Promise<unknown> {
    return this.gamification.getUserProgress(req.user.id as string);
  }

  @Get('streaks')
  @ApiOperation({ summary: 'Get streaks for the authenticated user' })
  @ApiOkResponse({ description: 'Daily and weekly streaks' })
  async getStreaks(@Req() req: any): Promise<unknown> {
    return this.gamification.getUserStreaks(req.user.id as string);
  }

  @Get('badges')
  @ApiOperation({ summary: 'Get badge catalogue and earned badges for the authenticated user' })
  @ApiOkResponse({ description: 'Badges and earned badge state' })
  async getBadges(@Req() req: any, @Query() query: GamificationBadgesQueryDto): Promise<unknown> {
    return this.gamification.getUserBadges(req.user.id as string, query);
  }

  @Get('points/history')
  @ApiOperation({ summary: 'Get point transaction history for the authenticated user' })
  @ApiOkResponse({ description: 'Point history and pagination' })
  async getPointHistory(@Req() req: any, @Query() query: PointHistoryQueryDto): Promise<unknown> {
    return this.gamification.getUserPointHistory(req.user.id as string, query);
  }

  @Post('badges/:badgeId/seen')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark an earned badge notification as seen' })
  @ApiNoContentResponse({ description: 'Badge state updated' })
  async markBadgeSeen(@Req() req: any, @Param('badgeId') badgeId: string) {
    await this.gamification.markBadgeSeen(req.user.id as string, badgeId);
  }
}
