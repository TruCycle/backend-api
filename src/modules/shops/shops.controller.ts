import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('shops')
@Controller('shops')
export class ShopsController {
  @Get('health')
  @ApiOperation({ summary: 'Shops service health check' })
  @ApiOkResponse({ description: 'Service is reachable', schema: { example: { status: 'success', message: 'OK', data: { status: 'ok' } } } })
  health() {
    return { status: 'ok' };
  }

  @Get('nearby')
  @ApiOperation({ summary: 'Find nearby shops by coordinates' })
  @ApiQuery({ name: 'lon', required: true, type: Number })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({ name: 'radius', required: false, type: Number })
  @ApiOkResponse({ description: 'Nearby shops list', schema: { example: { status: 'success', message: 'OK', data: [{ id: 'shop-id', name: 'Recycle Center', distanceMeters: 250 }] } } })
  nearby(@Query('lon') lon: number, @Query('lat') lat: number, @Query('radius') radius?: number) {
    // Placeholder implementation; will wire to GeoService later
    return { lon: Number(lon), lat: Number(lat), radius: radius ? Number(radius) : undefined };
  }
}

