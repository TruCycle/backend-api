import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { CreateRoomDto } from './dto/create-room.dto';
import { GeneralMessageDto } from './dto/general-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { SearchMessagesQueryDto } from './dto/search-messages-query.dto';
import { SendImageMessageDto } from './dto/send-image-message.dto';
import { MessagesService } from './messages.service';

const messageExample = {
  id: '1b8cf2e2-5f24-4dc4-8c0c-0c0fe5bc9f91',
  roomId: 'a438e1dc-1e7f-4b24-9d0f-4d2f2a5d5e7c',
  direction: 'outgoing',
  category: 'direct',
  imageUrl: null,
  caption: null,
  text: 'Looking forward to the pickup tomorrow!',
  createdAt: '2024-06-01T13:45:00.000Z',
  sender: {
    id: '9f0c9559-83d3-4afd-8a79-5f437c82c1d1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    profileImageUrl: null,
  },
};

const roomExample = {
  id: 'a438e1dc-1e7f-4b24-9d0f-4d2f2a5d5e7c',
  participants: [
    {
      id: '9f0c9559-83d3-4afd-8a79-5f437c82c1d1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      profileImageUrl: null,
      online: true,
    },
    {
      id: '2c4c0f2c-97f2-4e4f-96b4-e8d9ba1d21f6',
      firstName: 'Grace',
      lastName: 'Hopper',
      profileImageUrl: null,
      online: false,
    },
  ],
  lastMessage: messageExample,
  createdAt: '2024-05-30T09:12:00.000Z',
  updatedAt: '2024-06-01T13:45:00.000Z',
};

@ApiTags('messages')
@ApiBearerAuth()
@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post('rooms')
  @ApiOperation({ summary: 'Ensure a direct room exists between two users', operationId: 'createOrFindRoom' })
  @ApiBody({
    description: 'Identify the other user to open a room with.',
    schema: {
      type: 'object',
      required: ['otherUserId'],
      properties: {
        otherUserId: {
          type: 'string',
          format: 'uuid',
          example: '2c4c0f2c-97f2-4e4f-96b4-e8d9ba1d21f6',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Room summary including participants, last message, and timestamps.',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: roomExample,
      },
    },
  })
  async createRoom(@Req() req: any, @Body() dto: CreateRoomDto) {
    const userId = this.getUserId(req);
    return this.messages.ensureRoom(userId, dto.otherUserId);
  }

  @Get('rooms/active')
  @ApiOperation({ summary: 'List all active rooms for the authenticated user', operationId: 'listActiveRooms' })
  @ApiOkResponse({
    description: 'An array of rooms ordered by most recent activity.',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: [roomExample],
      },
    },
  })
  async listActiveRooms(@Req() req: any) {
    const userId = this.getUserId(req);
    return this.messages.listActiveRooms(userId);
  }

  @Get('rooms/:roomId/messages')
  @ApiOperation({ summary: 'Retrieve paginated messages within a room', operationId: 'listRoomMessages' })
  @ApiOkResponse({
    description: 'Messages ordered from oldest to newest with a pagination cursor.',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          messages: [messageExample],
          nextCursor: null,
        },
      },
    },
  })
  async listMessages(
    @Req() req: any,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    const userId = this.getUserId(req);
    return this.messages.listMessages(roomId, userId, query);
  }

  @Get('rooms/:roomId/search')
  @ApiOperation({ summary: 'Full-text search across a room conversation', operationId: 'searchRoomMessages' })
  @ApiOkResponse({
    description: 'Messages that match the provided query (minimum 3 characters).',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: [messageExample],
      },
    },
  })
  async searchMessages(
    @Req() req: any,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: SearchMessagesQueryDto,
  ) {
    const userId = this.getUserId(req);
    return this.messages.searchMessages(roomId, userId, query.query);
  }

  @Post('rooms/:roomId/messages/image')
  @UseInterceptors(FileInterceptor('image'))
  @ApiOperation({ summary: 'Send an image message to the room', operationId: 'sendImageMessage' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Multipart payload containing the image and optional caption.',
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Image file to upload',
        },
        caption: {
          type: 'string',
          example: 'Proof of collection',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'View model of the uploaded image message.',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          ...messageExample,
          category: 'direct',
          direction: 'outgoing',
          imageUrl: 'https://cdn.trucycle.com/messages/image-123.png',
          caption: 'Proof of collection',
          text: null,
        },
      },
    },
  })
  async sendImageMessage(
    @Req() req: any,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SendImageMessageDto,
  ) {
    const userId = this.getUserId(req);
    return this.messages.sendImageMessage(roomId, userId, file, dto);
  }

  @Post('rooms/:roomId/messages/general')
  @ApiOperation({ summary: 'Send a general/system message to the room', operationId: 'sendGeneralMessage' })
  @ApiBody({
    description: 'Plain-text message with an optional title.',
    schema: {
      type: 'object',
      required: ['text'],
      properties: {
        title: {
          type: 'string',
          example: 'Pickup reminder',
        },
        text: {
          type: 'string',
          example: 'Our driver will arrive tomorrow between 9am and 11am.',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'View model of the general message as seen by the sender.',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          ...messageExample,
          direction: 'general',
          category: 'general',
          caption: 'Pickup reminder',
          text: 'Our driver will arrive tomorrow between 9am and 11am.',
        },
      },
    },
  })
  async sendGeneralMessage(
    @Req() req: any,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: GeneralMessageDto,
  ) {
    const userId = this.getUserId(req);
    return this.messages.createGeneralMessage(roomId, userId, dto);
  }

  @Delete('rooms/:roomId/messages')
  @ApiOperation({ summary: 'Clear all messages in a room', operationId: 'clearRoomMessages' })
  @ApiOkResponse({
    description: 'Confirmation that the room history has been purged.',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          success: true,
        },
      },
    },
  })
  async clearMessages(@Req() req: any, @Param('roomId', ParseUUIDPipe) roomId: string) {
    const userId = this.getUserId(req);
    await this.messages.deleteRoomMessages(roomId, userId);
    return { success: true };
  }

  @Delete('rooms/:roomId')
  @ApiOperation({ summary: 'Delete a room and its messages', operationId: 'deleteRoom' })
  @ApiOkResponse({
    description: 'Confirmation that the room has been removed.',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          success: true,
        },
      },
    },
  })
  async deleteRoom(@Req() req: any, @Param('roomId', ParseUUIDPipe) roomId: string) {
    const userId = this.getUserId(req);
    await this.messages.deleteRoom(roomId, userId);
    return { success: true };
  }

  private getUserId(req: any): string {
    const sub = req?.user?.sub;
    if (!sub || typeof sub !== 'string') {
      throw new UnauthorizedException('Missing authenticated user');
    }
    return sub;
  }
}
