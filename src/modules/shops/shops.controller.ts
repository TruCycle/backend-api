import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { ShopsService } from './shops.service';

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
  @ApiOperation({ summary: 'Find nearby shops by coordinates', operationId: 'shopsNearby' })
  @ApiQuery({ name: 'lon', required: true, type: Number })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({ name: 'radius_m', required: false, type: Number, description: 'Search radius in meters (default ~5500m)' })
  @ApiOkResponse({ description: 'Nearby shops list', schema: { example: { status: 'success', message: 'OK', data: [{ id: 'b84e...-uuid', name: 'Partner Shop', distanceMeters: 250 }] } } })
  async nearby(@Query('lon') lon: string, @Query('lat') lat: string, @Query('radius_m') radius?: string) {
    const lonN = Number(lon);
    const latN = Number(lat);
    const rN = radius !== undefined ? Number(radius) : undefined;
    return this.shops.findNearby(lonN, latN, rN);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new shop (partner-managed)', operationId: 'createShop' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBody({ description: 'Shop details', type: CreateShopDto })
  @ApiCreatedResponse({ description: 'Shop created', schema: { example: { id: 'uuid', name: 'Shop A', phone_number: '+44 20 7946 0958', address_line: '1 High St', postcode: 'AB12 3CD', latitude: 51.5, longitude: -0.12, opening_hours: { days: ['Mon','Tue','Wed','Thu','Fri'], open_time: '09:00', close_time: '17:00' }, acceptable_categories: ['furniture','electronics'], active: true } } })
  async create(@Body() dto: CreateShopDto, @Req() req: any) {
    const user = req?.user;
    if (!user) throw new UnauthorizedException('Missing user context');
    return this.shops.createShop(user, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'List shops owned by the authenticated partner', operationId: 'listMyShops' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'List of owned shops', schema: { example: [{ id: 'uuid', name: 'Shop A' }] } })
  async listMine(@Req() req: any) {
    const user = req?.user;
    if (!user) throw new UnauthorizedException('Missing user context');
    return this.shops.listMyShops(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get public shop details by id', operationId: 'getShop' })
  @ApiOkResponse({ description: 'Shop', schema: { example: { id: 'uuid', name: 'Shop A' } } })
  async getOne(@Param('id') id: string) {
    return this.shops.getShopPublic(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a shop (owner or admin)', operationId: 'updateShop' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBody({ description: 'Fields to update', type: UpdateShopDto })
  @ApiOkResponse({ description: 'Updated shop', schema: { example: { id: 'uuid', name: 'Updated Name' } } })
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
}
