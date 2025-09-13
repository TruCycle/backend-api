import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const { user } = await this.auth.register(
      dto.email,
      dto.password,
      dto.role,
      dto.first_name,
      dto.last_name,
    );
    return {
      message: 'User registered successfully.',
      data: {
        user: {
          id: user.id,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          email: user.email,
          status: user.status,
        },
      },
    };
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const { user, token } = await this.auth.login(dto.email, dto.password);
    return { user, token };
  }
}
