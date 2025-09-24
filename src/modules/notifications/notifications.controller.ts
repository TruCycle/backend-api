import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  @Post('send')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  send(@Body() body: { userId: string; template: string; params?: any }) {
    return { queued: true, notificationId: 'stub', ...body };
  }
}
