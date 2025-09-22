import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreatePickupOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { SearchOrdersDto } from './dto/search-orders.dto';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(202)
  async create(@AuthUser() user: any, @Body() dto: CreatePickupOrderDto) {
    const result = await this.orders.create(user.sub, dto);
    return {
      status: 'success',
      message: 'Your listing has been submitted and is pending review.',
      data: result,
    };
  }

  @Get('search')
  @HttpCode(200)
  async search(@AuthUser() payload: any, @Query() query: SearchOrdersDto) {
    // Optional: restrict to collectors
    const roles: string[] = Array.isArray(payload?.roles) ? payload.roles : [];
    if (!roles.includes('collector') && !roles.includes('admin')) {
      throw new ForbiddenException('Collectors only');
    }
    const data = await this.orders.search(query);
    return {
      status: 'success',
      message: 'Listings retrieved.',
      data,
    };
  }
}
