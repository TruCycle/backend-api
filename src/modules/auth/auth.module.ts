import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Role } from '../users/role.entity';
import { UserRole } from '../users/user-role.entity';
import { AuthService } from './auth.service';
import { PasswordService } from '../../common/security/password.service';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, UserRole]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
    }),
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService],
  exports: [JwtModule],
})
export class AuthModule {}
