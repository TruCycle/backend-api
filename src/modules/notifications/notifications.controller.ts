import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  @Post('send')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Queue a notification to be sent' })
  @ApiBody({
    description: 'Notification job payload',
    schema: {
      type: 'object',
      required: ['userId', 'template'],
      properties: {
        userId: { type: 'string', format: 'uuid', example: 'c7f2c3a1-45b6-4ad4-9d8a-8f5b8c9a4d12' },
        template: { type: 'string', example: 'WELCOME' },
        params: { type: 'object', additionalProperties: true, example: { name: 'Jane' } },
      },
    },
  })
  @ApiOkResponse({ description: 'Queued job acknowledgment', schema: { example: { status: 'success', message: 'OK', data: { queued: true, notificationId: 'stub', userId: 'c7f2c3a1-45b6-4ad4-9d8a-8f5b8c9a4d12', template: 'WELCOME' } } } })
  send(@Body() body: { userId: string; template: string; params?: any }) {
    return { queued: true, notificationId: 'stub', ...body };
  }
}
