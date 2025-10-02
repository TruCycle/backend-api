import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User } from '../users/user.entity';

import { Message } from './message.entity';
import { MessageRoom } from './message-room.entity';
import { MessagesMediaService } from './messages-media.service';
import { MessagesPresenceService } from './messages-presence.service';
import { MessagesPublicController } from './messages-public.controller';
import { MessagesController } from './messages.controller';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';

@Module({
  imports: [TypeOrmModule.forFeature([MessageRoom, Message, User])],
  controllers: [MessagesController, MessagesPublicController],
  providers: [MessagesService, MessagesGateway, MessagesMediaService, MessagesPresenceService, JwtAuthGuard],
  exports: [MessagesService, MessagesPresenceService],
})
export class MessagesModule {}
