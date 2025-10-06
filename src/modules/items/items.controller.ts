import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags, ApiCreatedResponse } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { CreateItemDto } from './dto/create-item.dto';
import { SearchItemsDto } from './dto/search-items.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { UserCollectedItemsQueryDto, UserItemsQueryDto } from './dto/user-items-query.dto';
import { ItemsService } from './items.service';

@ApiTags('items')
@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get('health')
  @ApiOperation({ summary: 'Items service health check' })
  @ApiOkResponse({ description: 'Service is reachable', schema: { example: { status: 'success', message: 'OK', data: { status: 'ok' } } } })
  health() {
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: 'Retrieve public item listings near a location', operationId: 'searchItems' })
  @ApiOkResponse({ description: 'List of public items', schema: { example: { status: 'success', message: 'OK', data: [{ id: 'item-id', title: 'Reusable bottle' }] } } })
  async search(@Query() query: SearchItemsDto) {
    return this.items.searchPublicListings(query);
  }

  @Get('me/listed')
  @ApiOperation({ summary: 'List items created by the authenticated user', operationId: 'listMyItems' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'List of user listed items', schema: { example: { status: 'success', message: 'OK', data: [{ id: 'item-id', title: 'Reusable bottle' }] } } })
  async listMine(@Query() query: UserItemsQueryDto, @Req() req: any) {
    const userId = req?.user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    return this.items.getUserListedItems(userId, query);
  }

  @Get('me/collected')
  @ApiOperation({ summary: 'List items collected by the authenticated user', operationId: 'listMyCollectedItems' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'List of user collected items', schema: { example: { status: 'success', message: 'OK', data: [{ id: 'item-id', title: 'Aluminum can' }] } } })
  async listCollected(@Query() query: UserCollectedItemsQueryDto, @Req() req: any) {
    const userId = req?.user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    return this.items.getUserCollectedItems(userId, query);
  }

  @Get('me/impact')
  @ApiOperation({ summary: 'Get environmental impact metrics for the authenticated user', operationId: 'getMyImpactMetrics' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'Impact metrics summary', schema: { example: { status: 'success', message: 'OK', data: { itemsRecycled: 42, co2SavedKg: 12.5 } } } })
  async getImpact(@Req() req: any) {
    const userId = req?.user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    return this.items.getUserImpactMetrics(userId);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a single item listing by id', operationId: 'getItemById' })
  @ApiOkResponse({ description: 'Item details', schema: { example: { status: 'success', message: 'OK', data: { id: 'item-id', title: 'Reusable bottle' } } } })
  async findOne(@Param('id') id: string) {
    return this.items.getPublicItem(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing item listing', operationId: 'updateItem' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBody({ description: 'Fields to update on the item', type: UpdateItemDto })
  @ApiOkResponse({ description: 'Updated item details', schema: { example: { status: 'success', message: 'OK', data: { id: 'item-id', title: 'Updated title' } } } })
  async update(@Param('id') id: string, @Body() dto: UpdateItemDto, @Req() req: any) {
    const userId = req?.user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    return this.items.updateItem(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an existing item listing', operationId: 'deleteItem' })
  @ApiNoContentResponse({ description: 'Item deleted' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    await this.items.deleteItem(userId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new item listing', operationId: 'createItem' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBody({ description: 'Item details to create', type: CreateItemDto })
  @ApiCreatedResponse({ description: 'Item created', schema: { example: { status: 'success', message: 'OK', data: { id: 'item-id', title: 'Reusable bottle' } } } })
  async create(@Body() dto: CreateItemDto, @Req() req: any) {
    const userId = req?.user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    return this.items.createItem(userId, dto);
  }
}

