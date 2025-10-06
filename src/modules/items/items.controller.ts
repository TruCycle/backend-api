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
  @ApiOkResponse({
    description: 'List of public items with search origin',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          search_origin: { lat: 51.5074, lng: -0.1278, radius_km: 5 },
          items: [
            {
              id: 'item-id',
              title: 'Reusable bottle',
              status: 'active',
              distance_km: 0.8,
              pickup_option: 'exchange',
              qr_code: 'https://cdn.../qr.png',
              images: [{ url: 'https://...', altText: null }],
              estimated_co2_saved_kg: 1.2,
              owner: {
                id: 'user-id',
                name: 'Jane Doe',
                profile_image: null,
                verification: { email_verified: true, identity_verified: false, address_verified: false },
                rating: 4.9,
                reviews_count: 12,
              },
              created_at: '2024-06-01T10:00:00.000Z',
            },
          ],
        },
      },
    },
  })
  async search(@Query() query: SearchItemsDto) {
    return this.items.searchPublicListings(query);
  }

  @Get('me/listed')
  @ApiOperation({ summary: 'List items created by the authenticated user', operationId: 'listMyItems' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'User items and pagination',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          items: [
            {
              id: 'item-id',
              title: 'Reusable bottle',
              status: 'active',
              pickup_option: 'exchange',
              qr_code: 'https://...',
              images: [{ url: 'https://...', altText: null }],
              estimated_co2_saved_kg: 1.2,
              metadata: null,
              location: { address_line: '10 Downing St', postcode: 'SW1A 2AA', latitude: 51.5034, longitude: -0.1276 },
              created_at: '2024-06-01T10:00:00.000Z',
              claim: null,
            },
          ],
          pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
        },
      },
    },
  })
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
  @ApiOkResponse({
    description: 'Collected items and pagination',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          items: [
            {
              claim_id: 'claim-id',
              claim_status: 'complete',
              claim_created_at: '2024-06-01T10:00:00.000Z',
              claim_approved_at: '2024-06-01T10:30:00.000Z',
              claim_completed_at: '2024-06-01T12:00:00.000Z',
              item: {
                id: 'item-id',
                title: 'Aluminum can',
                status: 'recycled',
                pickup_option: 'recycle',
                qr_code: 'https://...',
                images: [{ url: 'https://...', altText: null }],
                estimated_co2_saved_kg: 0.2,
                location: { address_line: '1 Recycling Way', postcode: 'RC1 2CL', latitude: 51.5, longitude: -0.1 },
                created_at: '2024-06-01T09:00:00.000Z',
                owner: { id: 'user-id', name: 'Jane Doe', profile_image: null },
              },
            },
          ],
          pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
        },
      },
    },
  })
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
  @ApiOkResponse({
    description: 'Impact metrics summary',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          total_co2_saved_kg: 12.5,
          items_exchanged: 10,
          items_donated: 32,
          monthly_goal: {
            target_kg: 50,
            achieved_kg: 8.4,
            remaining_kg: 41.6,
            progress_percent: 16.8,
          },
        },
      },
    },
  })
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
  @ApiOkResponse({
    description: 'Updated item details',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          id: 'item-id',
          title: 'Updated title',
          condition: 'good',
          postcode: 'AB12 3CD',
          latitude: 51.5,
          longitude: -0.12,
          updated_at: '2024-06-01T11:00:00.000Z',
        },
      },
    },
  })
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
  @ApiCreatedResponse({
    description: 'Item created',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          id: 'item-id',
          title: 'Reusable bottle',
          status: 'pending_dropoff',
          pickup_option: 'donate',
          estimated_co2_saved_kg: 1.2,
          location: { address_line: '10 Downing St', postcode: 'SW1A 2AA', latitude: 51.5, longitude: -0.12 },
          qr_code: 'https://.../qr.png',
          created_at: '2024-06-01T10:00:00.000Z',
        },
      },
    },
  })
  async create(@Body() dto: CreateItemDto, @Req() req: any) {
    const userId = req?.user?.sub;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    return this.items.createItem(userId, dto);
  }
}

