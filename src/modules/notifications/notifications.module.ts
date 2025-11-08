import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailService } from './email.service';
import { NotificationsController } from './notifications.controller';
import { Notification } from './notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { UsersModule } from '../users/users.module';
import { User } from '../users/user.entity';
import { NearbyItemsAlertService } from './nearby-items-alert.service';
import { Item } from '../items/item.entity';
import { Shop } from '../shops/shop.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, User, Item, Shop]), forwardRef(() => UsersModule)],
  controllers: [NotificationsController],
  providers: [EmailService, NotificationsService, NotificationsGateway, NearbyItemsAlertService],
  exports: [EmailService, NotificationsService, NearbyItemsAlertService],
})
export class NotificationsModule {}
