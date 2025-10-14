import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { AuthService } from './auth.service';
import { ForgetPasswordDto } from './dto/forget-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CreateShopDto } from '../shops/dto/create-shop.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyDto } from './dto/verify.dto';


@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('health')
  @ApiOperation({ summary: 'Auth service health check' })
  @ApiOkResponse({ description: 'Service is reachable', schema: { example: { status: 'success', message: 'OK', data: { status: 'ok' } } } })
  health() {
    return { status: 'ok' };
  }

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user account',
    description:
      'To register as a partner you must include a valid `shop` payload. Partner role requires at least one shop and the first shop will be created during registration.',
  })
  @ApiBody({
    description: 'User registration payload. Note: `role`="partner" requires a `shop` object (first shop will be created).',
    type: RegisterDto,
  })
  @ApiCreatedResponse({
    description: 'User created successfully',
    schema: {
      example: {
        status: 'success',
        message: 'User registered successfully.',
        data: {
          user: {
            id: '3f2f8c2e-6b1a-4c8e-9a61-22f924e0f6f1',
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
            status: 'pending',
            roles: ['partner'],
          },
          shop: {
            id: 'b84e...-uuid',
            name: 'Jane\'s Outlet',
            phone_number: '+44 20 7946 0958',
            address_line: '1 High St',
            postcode: 'AB12 3CD',
            latitude: 51.5,
            longitude: -0.12,
            opening_hours: { days: ['Mon','Tue','Wed','Thu','Fri'], open_time: '09:00', close_time: '17:00' },
            acceptable_categories: ['furniture','electronics'],
            active: true,
          }
        },
      },
    },
  })
  async register(@Body() dto: RegisterDto) {
    const { user, shop } = await this.auth.register(
      dto.email,
      dto.password,
      dto.role,
      dto.first_name,
      dto.last_name,
      dto.shop,
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
          roles: (user as any).roles ?? undefined,
        },
        ...(shop ? { shop } : {}),
      },
    };
  }

  @Post('login')
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiBody({ description: 'Login credentials', type: LoginDto })
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Login success with access and refresh tokens',
    schema: {
      example: {
        status: 'success',
        message: 'Login successful.',
        data: {
          user: {
            id: '3f2f8c2e-6b1a-4c8e-9a61-22f924e0f6f1',
            email: 'jane@example.com',
            firstName: 'Jane',
            lastName: 'Doe',
            status: 'active',
          },
          tokens: {
            accessToken: 'eyJhbGciOi...access',
            refreshToken: 'eyJhbGciOi...refresh',
          },
        },
      },
    },
  })
  async login(@Body() dto: LoginDto) {
    const { user, tokens } = await this.auth.login(dto.email, dto.password);
    return {
      status: 'success',
      message: 'Login successful.',
      data: { user, tokens },
    };
  }

  @Post('resend-verification')
  @ApiOperation({ summary: 'Resend email verification link' })
  @ApiBody({ description: 'Email to resend verification to', type: ResendVerificationDto })
  @ApiOkResponse({ description: 'Success message returned', schema: { example: { status: 'success', message: 'Verification email sent successfully.', data: null } } })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.auth.resendVerification(dto.email);
    // Always return success to avoid email enumeration
    return { status: 'success', message: 'Verification email sent successfully.', data: null };
  }

  @Post('forget-password')
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiBody({ description: 'Email to send reset link to', type: ForgetPasswordDto })
  @ApiOkResponse({ description: 'Success message returned', schema: { example: { status: 'success', message: 'Reset password email sent successfully.', data: null } } })
  async forgetPassword(@Body() dto: ForgetPasswordDto) {
    await this.auth.requestPasswordReset(dto.email);
    // Always return success to avoid email enumeration
    return { status: 'success', message: 'Reset password email sent successfully.', data: null };
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify a user using a token' })
  @ApiBody({ description: 'Verification token payload', type: VerifyDto })
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Verification success with user and tokens',
    schema: {
      example: {
        status: 'success',
        message: 'Verification successfully.',
        data: {
          user: {
            id: '3f2f8c2e-6b1a-4c8e-9a61-22f924e0f6f1',
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
            status: 'active',
          },
          tokens: {
            accessToken: 'eyJhbGciOi...access',
            refreshToken: 'eyJhbGciOi...refresh',
          },
        },
      },
    },
  })
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
  @ApiOperation({ summary: 'Reset password using a token' })
  @ApiBody({ description: 'New password and reset token', type: ResetPasswordDto })
  @ApiOkResponse({ description: 'Success message returned', schema: { example: { status: 'success', message: 'Password changed successfully.', data: null } } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.new_password);
    return { status: 'success', message: 'Password changed successfully.', data: null };
  }

  @Get('me')
  @ApiOperation({ summary: 'Retrieve the current user profile' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Current user basic profile',
    schema: {
      example: {
        status: 'success',
        message: 'User retrieved successfully.',
        data: {
          user: {
            id: '3f2f8c2e-6b1a-4c8e-9a61-22f924e0f6f1',
            email: 'jane@example.com',
            firstName: 'Jane',
            lastName: 'Doe',
            status: 'active',
            roles: ['customer', 'partner'],
          },
        },
      },
    },
  })
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

  @Post('upgrade-to-partner')
  @ApiOperation({
    summary: 'Upgrade the current user to Partner',
    description:
      'Partner role requires at least one shop. If you do not already have a shop, you must provide `shop` details to create your first shop as part of the upgrade.',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBody({
    description: 'Partner shop details. Required if the user has no existing shop; optional if at least one shop already exists.',
    type: CreateShopDto,
    required: false,
  })
  @ApiOkResponse({
    description: 'User upgraded to partner and optional shop created',
    schema: {
      example: {
        status: 'success',
        message: 'Upgraded to partner successfully.',
        data: {
          user: { id: 'uuid', email: 'jane@example.com', roles: ['partner','customer'] },
          shop: {
            id: 'b84e...-uuid',
            name: "Jane's Outlet",
            address_line: '1 High St',
            postcode: 'AB12 3CD',
            latitude: 51.5,
            longitude: -0.12,
            acceptable_categories: ['furniture','electronics'],
            active: true,
          },
        },
      },
    },
  })
  async upgradeToPartner(@AuthUser() payload: any, @Body() shopDto?: CreateShopDto) {
    const { user, shop } = await this.auth.upgradeToPartner(payload, shopDto);
    return {
      status: 'success',
      message: 'Upgraded to partner successfully.',
      data: { user, ...(shop ? { shop } : {}) },
    };
  }
}
