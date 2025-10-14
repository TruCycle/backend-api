import { Module , forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PasswordService } from '../../common/security/password.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { Role } from '../users/role.entity';
import { UserRole } from '../users/user-role.entity';
import { User } from '../users/user.entity';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Shop } from '../shops/shop.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, UserRole, Shop]),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, JwtAuthGuard],
  exports: [],
})
export class AuthModule {}
