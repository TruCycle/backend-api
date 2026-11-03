import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthSession } from '../../modules/auth/auth-session.entity';
import { AuthSessionsService } from '../../modules/auth/auth-sessions.service';

import { buildJwtOptions } from './jwt-options';
import { AUTH_SESSION_OPTIONS, buildAuthSessionOptions } from './auth-session-options';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({ useFactory: () => buildJwtOptions(process.env) }),
    TypeOrmModule.forFeature([AuthSession]),
  ],
  providers: [AuthSessionsService, { provide: AUTH_SESSION_OPTIONS, useFactory: () => buildAuthSessionOptions(process.env) }],
  exports: [JwtModule, AuthSessionsService],
})
export class JwtAuthModule {}

