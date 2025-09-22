import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './auth.service';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyDto } from './dto/verify.dto';
import { ForgetPasswordDto } from './dto/forget-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';

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
  @HttpCode(200)
  async login(@Body() dto: LoginDto) {
    const { user, tokens } = await this.auth.login(dto.email, dto.password);
    return {
      status: 'success',
      message: 'Login successful.',
      data: { user, tokens },
    };
  }

  @Post('resend-verification')
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.auth.resendVerification(dto.email);
    // Always return success to avoid email enumeration
    return { status: 'success', message: 'Verification email sent successfully.', data: null };
  }

  @Post('forget-password')
  async forgetPassword(@Body() dto: ForgetPasswordDto) {
    await this.auth.requestPasswordReset(dto.email);
    // Always return success to avoid email enumeration
    return { status: 'success', message: 'Reset password email sent successfully.', data: null };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() dto: VerifyDto) {
    const { user, tokens } = await this.auth.verifyUser(dto.token);
    return {
      status: 'success',
      message: 'Verification successfully.',
      data: {
        user: {
          id: user.id,
          firstName: (user as any).firstName ?? null,
          lastName: (user as any).lastName ?? null,
          email: (user as any).email,
          status: (user as any).status,
        },
        tokens,
      },
    };
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.new_password);
    return { status: 'success', message: 'Password changed successfully.', data: null };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@AuthUser() payload: any) {
    const user = await this.auth.getBasicProfileById(payload.sub);
    return {
      status: 'success',
      message: 'User retrieved successfully.',
      data: {
        user,
      },
    };
  }
}
