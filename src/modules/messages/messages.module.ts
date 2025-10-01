import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Message } from './message.entity';
import { MessageRoom } from './message-room.entity';
import { MessagesController } from './messages.controller';
import { MessagesGateway } from './messages.gateway';
import { MessagesMediaService } from './messages-media.service';
import { MessagesPresenceService } from './messages-presence.service';
import { MessagesService } from './messages.service';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MessageRoom, Message, User])],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway, MessagesMediaService, MessagesPresenceService, JwtAuthGuard],
  exports: [MessagesService, MessagesPresenceService],
})
export class MessagesModule {}
