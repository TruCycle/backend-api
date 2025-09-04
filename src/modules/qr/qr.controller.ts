import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';

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

