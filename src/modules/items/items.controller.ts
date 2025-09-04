import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

class CreateItemDto {
  name!: string;
}

@ApiTags('items')
@Controller('items')
export class ItemsController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Post()
  create(@Body() dto: CreateItemDto) {
    return { id: 'stub', name: dto.name, status: 'listed' };
  }
}

