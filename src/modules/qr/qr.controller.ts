import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ClaimsService } from '../claims/claims.service';

import { DropoffScanDto, ShopScanDto } from './dto/shop-scan.dto';
import { QrService } from './qr.service';

class ScanDto {
  qrPayload!: string;
  direction!: 'in' | 'out';
  location?: { type: 'Point'; coordinates: [number, number] };
  shopId?: string;
}

@ApiTags('qr')
@Controller('qr')
export class QrController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly qr: QrService,
  ) {}

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

  @Get('item/:itemId/view')
  @ApiOperation({ summary: 'Retrieve QR item context', operationId: 'viewItemViaQr' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'itemId', description: 'UUID of the item', type: 'string' })
  async view(
    @AuthUser() user: any,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    return this.qr.viewItem(user, itemId);
  }

  @Post('item/:itemId/dropoff-in')
  @ApiOperation({ summary: 'Register a donor drop-off', operationId: 'dropoffInViaQr' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'itemId', description: 'UUID of the item being dropped off', type: 'string' })
  async dropoffIn(
    @AuthUser() user: any,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body() dto: DropoffScanDto,
  ) {
    return this.qr.registerDropoff(user, itemId, dto.shopId, dto.action, dto.reason);
  }

  @Post('item/:itemId/claim-out')
  @ApiOperation({ summary: 'Complete a claim via QR scan', operationId: 'completeClaimViaQr' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'itemId', description: 'UUID of the item being claimed out', type: 'string' })
  async claimOut(
    @AuthUser() user: any,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body() dto: ShopScanDto,
  ) {
    return this.claims.completeClaimOut(user, itemId, dto.shopId);
  }

  @Post('item/:itemId/recycle-in')
  @ApiOperation({ summary: 'Register recycle intake', operationId: 'recycleInViaQr' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'itemId', description: 'UUID of the item entering recycle processing', type: 'string' })
  async recycleIn(
    @AuthUser() user: any,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body() dto: ShopScanDto,
  ) {
    return this.qr.registerRecycleIn(user, itemId, dto.shopId);
  }

  @Post('item/:itemId/recycle-out')
  @ApiOperation({ summary: 'Mark recycle completion', operationId: 'recycleOutViaQr' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'itemId', description: 'UUID of the item completing recycle processing', type: 'string' })
  async recycleOut(
    @AuthUser() user: any,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body() dto: ShopScanDto,
  ) {
    return this.qr.registerRecycleOut(user, itemId, dto.shopId);
  }
}