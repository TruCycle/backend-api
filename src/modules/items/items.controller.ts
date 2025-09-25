import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('items')
@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new item listing', operationId: 'createItem' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateItemDto, @Req() req: any) {
    const userId = req?.user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    return this.items.createItem(userId, dto);
  }
}
