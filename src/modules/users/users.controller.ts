import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileImageDto } from './dto/update-profile-image.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users (admin/debug)' })
  @ApiOkResponse({
    description: 'Array of users',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: [
          {
            id: 'user-id',
            email: 'user@example.com',
            firstName: 'Jane',
            lastName: 'Doe',
            status: 'active',
            profileImageUrl: null,
            createdAt: '2024-06-01T10:00:00.000Z',
          },
        ],
      },
    },
  })
  async list() {
    return this.users.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Create a user (admin/debug)' })
  @ApiBody({ description: 'User creation payload', type: CreateUserDto })
  @ApiOkResponse({
    description: 'Created user',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: { id: 'user-id', email: 'user@example.com' },
      },
    },
  })
  async create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get(':id/verification')
  @ApiOperation({ summary: 'Retrieve user verification status' })
  @ApiOkResponse({
    description: 'Verification info',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: { email_verified: true, identity_verified: false, address_verified: true },
      },
    },
  })
  async verification(@Param('id') id: string) {
    return this.users.getVerification(id);
  }

  @Patch('me/profile-image')
  @ApiOperation({ summary: 'Update current user profile image' })
  @ApiBody({ description: 'Profile image payload', type: UpdateProfileImageDto })
  @ApiOkResponse({
    description: 'Updated image URL',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: { id: 'user-id', profile_image_url: 'https://...' },
      },
    },
  })
  async updateProfileImage(@Req() req: any, @Body() dto: UpdateProfileImageDto) {
    const userId = req?.user?.sub;
    return this.users.updateProfileImage(userId, dto.profileImageUrl);
  }

  @Patch('me/profile')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiBody({ description: 'Profile fields payload', type: UpdateProfileDto })
  @ApiOkResponse({
    description: 'Updated profile',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: { id: 'user-id', first_name: 'Jane', last_name: 'Doe', phone: null },
      },
    },
  })
  async updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const userId = req?.user?.sub;
    return this.users.updateProfile(userId, dto);
  }
}
