import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../modules/users/user.entity';
import { AuthSessionsService } from '../../modules/auth/auth-sessions.service';
import { verifyAccessToken } from '../security/access-token';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly sessions: AuthSessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const raw = (req.headers['authorization'] as string | undefined)?.trim();
    if (!raw) {
      throw new UnauthorizedException('Missing authorization header');
    }
    // Be lenient: accept "Bearer <token>", "bearer <token>", or if Swagger double-prefixes ("Bearer Bearer <token>")
    let token = raw;
    const bearer = /^Bearer\s+/i;
    while (bearer.test(token)) token = token.replace(bearer, '').trim();
    // Strip surrounding quotes if present (Swagger/curl may include them)
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith('\'') && token.endsWith('\''))) {
      token = token.slice(1, -1).trim();
    }
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    req.user = await verifyAccessToken(this.jwt, this.users, token, this.sessions);
    return true;
  }
}
