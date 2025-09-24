import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Role } from '../users/role.entity';
import { UserRole } from '../users/user-role.entity';
import { AuthService } from './auth.service';
import { PasswordService } from '../../common/security/password.service';
import { forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, UserRole]),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, JwtAuthGuard],
  exports: [],
})
export class AuthModule {}
