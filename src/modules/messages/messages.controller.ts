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

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateRoomDto } from './dto/create-room.dto';
import { MessagesService } from './messages.service';
import { GeneralMessageDto } from './dto/general-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { SearchMessagesQueryDto } from './dto/search-messages-query.dto';
import { SendImageMessageDto } from './dto/send-image-message.dto';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post('rooms')
  async createRoom(@Req() req: any, @Body() dto: CreateRoomDto) {
    const userId = this.getUserId(req);
    return this.messages.ensureRoom(userId, dto.otherUserId);
  }

  @Get('rooms/active')
  async listActiveRooms(@Req() req: any) {
    const userId = this.getUserId(req);
    return this.messages.listActiveRooms(userId);
  }

  @Get('rooms/:roomId/messages')
  async listMessages(
    @Req() req: any,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    const userId = this.getUserId(req);
    return this.messages.listMessages(roomId, userId, query);
  }

  @Get('rooms/:roomId/search')
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
  async sendGeneralMessage(
    @Req() req: any,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: GeneralMessageDto,
  ) {
    const userId = this.getUserId(req);
    return this.messages.createGeneralMessage(roomId, userId, dto);
  }

  @Delete('rooms/:roomId/messages')
  async clearMessages(@Req() req: any, @Param('roomId', ParseUUIDPipe) roomId: string) {
    const userId = this.getUserId(req);
    await this.messages.deleteRoomMessages(roomId, userId);
    return { success: true };
  }

  @Delete('rooms/:roomId')
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
