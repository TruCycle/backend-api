import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { ShopsService } from './shops.service';
import { ShopItemsQueryDto } from './dto/shop-items-query.dto';

@ApiTags('shops')
@Controller('shops')
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}
  @Get('health')
  @ApiOperation({ summary: 'Shops service health check' })
  @ApiOkResponse({ description: 'Service is reachable', schema: { example: { status: 'success', message: 'OK', data: { status: 'ok' } } } })
  health() {
    return { status: 'ok' };
  }

  @Get('nearby')
  @ApiOperation({
    summary: 'Find nearby shops by coordinates or postcode',
    description: 'Provide either lon/lat, or a postcode to geocode. If `postcode` is provided, `lon` and `lat` are ignored.',
    operationId: 'shopsNearby',
  })
  @ApiQuery({ name: 'lon', required: false, type: Number, description: 'Longitude in degrees (WGS84)', example: -0.1276 })
  @ApiQuery({ name: 'lat', required: false, type: Number, description: 'Latitude in degrees (WGS84)', example: 51.5072 })
  @ApiQuery({ name: 'postcode', required: false, type: String, description: 'UK postcode or address to geocode', example: 'SW1A 1AA' })
  @ApiQuery({ name: 'radius_m', required: false, type: Number, description: 'Search radius in meters (default ~5500m)', example: 2000 })
  @ApiOkResponse({
    description: 'Nearby shops list',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: [
          {
            id: 'b84e0c5d-3f9b-4a6e-9b6b-9a5d4f2b1234',
            name: 'Partner Shop',
            phone_number: '+44 20 7946 0958',
            address_line: '1 High St',
            postcode: 'AB12 3CD',
            latitude: 51.5072,
            longitude: -0.1276,
            operational_notes: 'Back entrance on Church St. Ring bell.',
            opening_hours: { days: ['Mon','Tue','Wed','Thu','Fri'], open_time: '09:00', close_time: '17:00' },
            acceptable_categories: ['furniture','electronics'],
            distanceMeters: 250,
          },
          {
            id: '0b86d6fb-5b12-4e45-a5ed-93b30fe7518a',
            name: 'Another Shop',
            phone_number: null,
            address_line: '2 Market Rd',
            postcode: 'EF45 6GH',
            latitude: 51.51,
            longitude: -0.13,
            operational_notes: null,
            opening_hours: null,
            acceptable_categories: [],
            distanceMeters: 980,
          },
        ],
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters',
    schema: {
      example: { status: 'error', message: 'Either postcode or lon/lat is required' },
    },
  })
  async nearby(
    @Query('lon') lon?: string,
    @Query('lat') lat?: string,
    @Query('postcode') postcode?: string,
    @Query('radius_m') radius?: string,
  ) {
    const rN = radius !== undefined ? Number(radius) : undefined;
    const pc = (postcode ?? '').trim();

    if (pc) {
      return this.shops.findNearbyByPostcode(pc, rN);
    }

    if (lon !== undefined && lat !== undefined) {
      const lonN = Number(lon);
      const latN = Number(lat);
      return this.shops.findNearby(lonN, latN, rN);
    }

    throw new BadRequestException('Either postcode or lon/lat is required');
  }

  @Post()
  @ApiOperation({ summary: 'Create a new shop (partner-managed)', operationId: 'createShop' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBody({ description: 'Shop details', type: CreateShopDto })
  @ApiCreatedResponse({
    description: 'Shop created',
    schema: {
      example: {
        id: 'uuid',
        name: 'Shop A',
        phone_number: '+44 20 7946 0958',
        address_line: '1 High St',
        postcode: 'AB12 3CD',
        operational_notes: 'Back entrance on Church St. Ring bell.',
        latitude: 51.5,
        longitude: -0.12,
        opening_hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], open_time: '09:00', close_time: '17:00' },
        acceptable_categories: ['furniture', 'electronics'],
        active: true,
        created_at: '2024-05-20T08:00:00.000Z',
        updated_at: '2024-05-20T08:00:00.000Z',
      },
    },
  })
  async create(@Body() dto: CreateShopDto, @Req() req: any) {
    const user = req?.user;
    if (!user) throw new UnauthorizedException('Missing user context');
    return this.shops.createShop(user, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'List shops owned by the authenticated partner', operationId: 'listMyShops' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'List of owned shops',
    schema: {
      example: [
        {
          id: 'uuid',
          name: 'Shop A',
          phone_number: '+44 20 7946 0958',
          address_line: '1 High St',
          postcode: 'AB12 3CD',
          operational_notes: 'Back entrance on Church St. Ring bell.',
          latitude: 51.5,
          longitude: -0.12,
          opening_hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], open_time: '09:00', close_time: '17:00' },
          acceptable_categories: ['furniture', 'electronics'],
          active: true,
          created_at: '2024-05-20T08:00:00.000Z',
          updated_at: '2024-05-20T08:00:00.000Z',
        },
      ],
    },
  })
  async listMine(@Req() req: any) {
    const user = req?.user;
    if (!user) throw new UnauthorizedException('Missing user context');
    return this.shops.listMyShops(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get public shop details by id', operationId: 'getShop' })
  @ApiOkResponse({
    description: 'Shop',
    schema: {
      example: {
        id: 'uuid',
        name: 'Shop A',
        phone_number: '+44 20 7946 0958',
        address_line: '1 High St',
        postcode: 'AB12 3CD',
        operational_notes: 'Back entrance on Church St. Ring bell.',
        latitude: 51.5,
        longitude: -0.12,
        opening_hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], open_time: '09:00', close_time: '17:00' },
        acceptable_categories: ['furniture', 'electronics'],
        active: true,
        created_at: '2024-05-20T08:00:00.000Z',
        updated_at: '2024-05-20T08:00:00.000Z',
      },
    },
  })
  async getOne(@Param('id') id: string) {
    return this.shops.getShopPublic(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a shop (owner or admin)', operationId: 'updateShop' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBody({ description: 'Fields to update', type: UpdateShopDto })
  @ApiOkResponse({
    description: 'Updated shop',
    schema: {
      example: {
        id: 'uuid',
        name: 'Updated Name',
        phone_number: '+44 20 7946 0958',
        address_line: '1 High St',
        postcode: 'AB12 3CD',
        operational_notes: 'Back entrance on Church St. Ring bell.',
        latitude: 51.5,
        longitude: -0.12,
        opening_hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], open_time: '09:00', close_time: '17:00' },
        acceptable_categories: ['furniture', 'electronics'],
        active: true,
        created_at: '2024-05-20T08:00:00.000Z',
        updated_at: '2024-06-01T08:00:00.000Z',
      },
    },
  })
  async update(@Param('id') id: string, @Body() dto: UpdateShopDto, @Req() req: any) {
    const user = req?.user;
    if (!user) throw new UnauthorizedException('Missing user context');
    return this.shops.updateShop(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archive a shop (owner or admin)', operationId: 'deleteShop' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiNoContentResponse({ description: 'Shop archived' })
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: any) {
    const user = req?.user;
    if (!user) throw new UnauthorizedException('Missing user context');
    await this.shops.deleteShop(user, id);
  }

  @Get('me/items')
  @ApiOperation({ summary: 'List items across my shops (partner/admin)', operationId: 'listMyShopItems' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Items and pagination',
    schema: {
      example: {
        items: [
          {
            id: 'item-id',
            title: 'Reusable bottle',
            status: 'pending_dropoff',
            pickup_option: 'donate',
            qr_code: 'https://.../qr.png',
            images: [{ url: 'https://...', alt_text: null }],
            estimated_co2_saved_kg: 1.2,
            metadata: { brand: 'TruCycle' },
            location: { address_line: '10 Downing St', postcode: 'SW1A 2AA', latitude: 51.5034, longitude: -0.1276 },
            created_at: '2024-06-01T10:00:00.000Z',
            claim: {
              id: 'claim-id',
              status: 'pending_dropoff',
              approved_at: '2024-06-02T09:00:00.000Z',
              completed_at: null,
              collector: { id: 'collector-id', name: 'John Smith', profile_image: null },
            },
            dropoff_location: {
              id: 'shop-id',
              name: 'TruCycle Hub',
              phone_number: '+44 20 7946 0958',
              address_line: '1 High St',
              postcode: 'AB12 3CD',
              operational_notes: 'Back entrance on Church St. Ring bell.',
              latitude: 51.509,
              longitude: -0.133,
              opening_hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], open_time: '09:00', close_time: '17:00' },
              acceptable_categories: ['furniture', 'electronics'],
              active: true,
              created_at: '2024-05-20T08:00:00.000Z',
              updated_at: '2024-05-20T08:00:00.000Z',
            },
          },
        ],
        pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
      },
    },
  })
  async listMyShopItems(@Query() query: ShopItemsQueryDto, @Req() req: any) {
    const user = req?.user;
    if (!user) throw new UnauthorizedException('Missing user context');
    return this.shops.listMyShopItems(user, query);
  }

  @Get(':id/items')
  @ApiOperation({ summary: 'List items associated with a shop (partner/admin)', operationId: 'listShopItems' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Items and pagination',
    schema: {
      example: {
        items: [
          {
            id: 'item-id',
            title: 'Reusable bottle',
            status: 'pending_dropoff',
            pickup_option: 'donate',
            qr_code: 'https://.../qr.png',
            images: [{ url: 'https://...', alt_text: null }],
            estimated_co2_saved_kg: 1.2,
            metadata: { brand: 'TruCycle' },
            location: { address_line: '10 Downing St', postcode: 'SW1A 2AA', latitude: 51.5034, longitude: -0.1276 },
            created_at: '2024-06-01T10:00:00.000Z',
            claim: {
              id: 'claim-id',
              status: 'pending_dropoff',
              approved_at: '2024-06-02T09:00:00.000Z',
              completed_at: null,
              collector: { id: 'collector-id', name: 'John Smith', profile_image: null },
            },
            dropoff_location: {
              id: 'shop-id',
              name: 'TruCycle Hub',
              phone_number: '+44 20 7946 0958',
              address_line: '1 High St',
              postcode: 'AB12 3CD',
              operational_notes: 'Back entrance on Church St. Ring bell.',
              latitude: 51.509,
              longitude: -0.133,
              opening_hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], open_time: '09:00', close_time: '17:00' },
              acceptable_categories: ['furniture', 'electronics'],
              active: true,
              created_at: '2024-05-20T08:00:00.000Z',
              updated_at: '2024-05-20T08:00:00.000Z',
            },
          },
        ],
        pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
      },
    },
  })
  async listShopItems(@Param('id') id: string, @Query() query: ShopItemsQueryDto, @Req() req: any) {
    const user = req?.user;
    if (!user) throw new UnauthorizedException('Missing user context');
    return this.shops.listShopItems(user, id, query);
  }
}
