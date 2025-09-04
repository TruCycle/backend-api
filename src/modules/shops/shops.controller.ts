import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('shops')
@Controller('shops')
export class ShopsController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('nearby')
  @ApiQuery({ name: 'lon', required: true, type: Number })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({ name: 'radius', required: false, type: Number })
  nearby(@Query('lon') lon: number, @Query('lat') lat: number, @Query('radius') radius?: number) {
    // Placeholder implementation; will wire to GeoService later
    return { lon: Number(lon), lat: Number(lat), radius: radius ? Number(radius) : undefined };
  }
}

