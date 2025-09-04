import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
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
}

