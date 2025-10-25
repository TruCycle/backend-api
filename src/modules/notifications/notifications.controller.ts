import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List notifications for the current user' })
  @ApiQuery({ name: 'unread', required: false, schema: { type: 'boolean' } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } })
  @ApiOkResponse({ description: 'Array of notifications' })
  async list(@Req() req: any, @Query() query: ListNotificationsQueryDto) {
    const userId = req.user.id as string;
    const unread = typeof query.unread === 'string' ? query.unread === 'true' : undefined;
    const limit = query.limit ? Number(query.limit) : undefined;
    const rows = await this.notifications.listForUser(userId, { unread, limit });
    return rows;
  }

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
  @ApiOkResponse({ description: 'Immediate in-app notification created and emitted if online' })
  async send(@Body() body: { userId: string; template: string; params?: any }) {
    // For now, treat this as a simple in-app notification for testing
    const type = 'general';
    const title = body.template || 'Notification';
    const data = body.params || {};
    const view = await this.notifications.createAndEmit(body.userId, type as any, title, null, data);
    return view;
  }
}
