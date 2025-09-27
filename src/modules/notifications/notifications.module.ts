import { Module } from '@nestjs/common';

import { EmailService } from './email.service';
import { NotificationsController } from './notifications.controller';

@Module({ controllers: [NotificationsController], providers: [EmailService], exports: [EmailService] })
export class NotificationsModule {}
