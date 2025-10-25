import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailService } from './email.service';
import { NotificationsController } from './notifications.controller';
import { Notification } from './notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { UsersModule } from '../users/users.module';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, User]), forwardRef(() => UsersModule)],
  controllers: [NotificationsController],
  providers: [EmailService, NotificationsService, NotificationsGateway],
  exports: [EmailService, NotificationsService],
})
export class NotificationsModule {}
