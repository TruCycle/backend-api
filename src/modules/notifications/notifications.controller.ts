import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  @Post('send')
  send(@Body() body: { userId: string; template: string; params?: any }) {
    return { queued: true, notificationId: 'stub', ...body };
  }
}

