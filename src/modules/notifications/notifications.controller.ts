import { Body, Controller, Get, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  private getUserId(req: any): string {
    const candidate = req?.user?.sub ?? req?.user?.id ?? req?.user?.userId;
    const userId = typeof candidate === 'string' ? candidate.trim() : '';
    if (!userId) {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    return userId;
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List notifications for the current user' })
  @ApiQuery({ name: 'unread', required: false, schema: { type: 'boolean' } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } })
  @ApiOkResponse({
    description: 'Array of notifications',
    schema: {
      example: [
        {
          id: '3b6e6f89-3a1b-4f12-9f51-1f2a4b0aa001',
          type: 'item.claim.request',
          title: 'New claim request',
          body: 'Your item “Bike” has a new claim request.',
          data: { itemId: 'c9c2f0fd-2f0a-4f9b-9b70-2e84d8a1b2d3' },
          read: false,
          readAt: null,
          createdAt: '2025-10-07T12:34:56.000Z',
        },
      ],
    },
  })
  async list(@Req() req: any, @Query() query: ListNotificationsQueryDto) {
    const userId = this.getUserId(req);
    const unread = typeof query.unread === 'string' ? query.unread === 'true' : undefined;
    const limit = query.limit ? Number(query.limit) : undefined;
    const rows = await this.notifications.listForUser(userId, { unread, limit });
    return rows;
  }

  @Get('unread-count')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get unread notifications count for the current user' })
  @ApiOkResponse({ description: 'Unread count payload', schema: { example: { count: 3 } } })
  async unreadCount(@Req() req: any) {
    const userId = this.getUserId(req);
    const count = await this.notifications.countUnread(userId);
    return { count };
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
