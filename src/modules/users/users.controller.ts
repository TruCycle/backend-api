import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileImageDto } from './dto/update-profile-image.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list() {
    return this.users.findAll();
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get(':id/verification')
  async verification(@Param('id') id: string) {
    return this.users.getVerification(id);
  }

  @Patch('me/profile-image')
  async updateProfileImage(@Req() req: any, @Body() dto: UpdateProfileImageDto) {
    const userId = req?.user?.sub;
    return this.users.updateProfileImage(userId, dto.profileImageUrl);
  }
}
