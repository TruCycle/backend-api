import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

class ScanDto {
  qrPayload!: string;
  direction!: 'in' | 'out';
  location?: { type: 'Point'; coordinates: [number, number] };
  shopId?: string;
}

@ApiTags('qr')
@Controller('qr')
export class QrController {
  @Post('scan')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  scan(@Body() dto: ScanDto, @Headers('idempotency-key') idemp?: string) {
    return {
      accepted: true,
      duplicate: false,
      idempotencyKey: idemp || null,
      direction: dto.direction,
    };
  }
}
