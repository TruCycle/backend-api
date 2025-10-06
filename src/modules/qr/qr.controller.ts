import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

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
  @ApiOperation({ summary: 'Scan a QR code and register action' })
  @ApiBody({
    description: 'Generic scan payload',
    schema: {
      type: 'object',
      required: ['qrPayload', 'direction'],
      properties: {
        qrPayload: { type: 'string', example: 'QR:ITEM:1234...' },
        direction: { type: 'string', enum: ['in', 'out'] },
        location: {
          type: 'object',
          required: ['type', 'coordinates'],
          properties: {
            type: { type: 'string', example: 'Point' },
            coordinates: { type: 'array', items: { type: 'number' }, example: [7.49, 9.07] },
          },
        },
        shopId: { type: 'string', format: 'uuid', example: 'e1d9f1a1-2c3b-4d5e-9f7a-1b2c3d4e5f6a' },
      },
    },
  })
  @ApiOkResponse({ description: 'Scan accepted acknowledgment', schema: { example: { status: 'success', message: 'OK', data: { accepted: true, duplicate: false, idempotencyKey: 'abc123', direction: 'in' } } } })
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
  @ApiOkResponse({
    description: 'Item context view (status, pickup option, QR, latest claim summary, scan events)',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          id: 'item-id',
          status: 'awaiting_collection',
          pickup_option: 'exchange',
          qr_code: 'https://cdn.trucycle.com/qrs/item-123.png',
          claim: {
            id: 'claim-id',
            status: 'approved',
            collector_id: 'collector-user-id',
          },
          scan_events: [
            { scan_type: 'ITEM_VIEW', shop_id: null, scanned_at: '2024-06-01T10:00:00.000Z' },
            { scan_type: 'DROP_OFF_IN', shop_id: 'SHOP123', scanned_at: '2024-06-01T09:00:00.000Z' },
          ],
        },
      },
    },
  })
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
  @ApiBody({ description: 'Dropoff scan payload', type: DropoffScanDto })
  @ApiOkResponse({
    description: 'Dropoff registered result with current item status and scan history',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          scan_result: 'accepted',
          scan_type: 'DROP_OFF_IN',
          item_status: 'awaiting_collection',
          scanned_at: '2024-06-01T10:00:00.000Z',
          scan_events: [
            { scan_type: 'DROP_OFF_IN', shop_id: 'SHOP123', scanned_at: '2024-06-01T10:00:00.000Z' },
          ],
        },
      },
    },
  })
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
  @ApiBody({ description: 'Shop scan payload', type: ShopScanDto })
  @ApiOkResponse({
    description: 'Claim completion registered with outcome and scan history',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          id: 'claim-id',
          status: 'complete',
          scan_type: 'CLAIM_OUT',
          scan_result: 'completed',
          completed_at: '2024-06-01T11:00:00.000Z',
          scan_events: [
            { scan_type: 'CLAIM_OUT', shop_id: 'SHOP123', scanned_at: '2024-06-01T11:00:00.000Z' },
          ],
        },
      },
    },
  })
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
  @ApiBody({ description: 'Shop scan payload', type: ShopScanDto })
  @ApiOkResponse({
    description: 'Recycle intake registered with timestamp and scan history',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          id: 'item-id',
          status: 'pending_recycle_processing',
          recycle_in_at: '2024-06-01T12:00:00.000Z',
          shop_id: 'SHOP123',
          scan_events: [
            { scan_type: 'RECYCLE_IN', shop_id: 'SHOP123', scanned_at: '2024-06-01T12:00:00.000Z' },
          ],
        },
      },
    },
  })
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
  @ApiBody({ description: 'Shop scan payload', type: ShopScanDto })
  @ApiOkResponse({
    description: 'Recycle completion registered with timestamp and scan history',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          id: 'item-id',
          status: 'recycled',
          recycle_out_at: '2024-06-01T14:00:00.000Z',
          shop_id: 'SHOP123',
          scan_events: [
            { scan_type: 'RECYCLE_OUT', shop_id: 'SHOP123', scanned_at: '2024-06-01T14:00:00.000Z' },
          ],
        },
      },
    },
  })
  async recycleOut(
    @AuthUser() user: any,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body() dto: ShopScanDto,
  ) {
    return this.qr.registerRecycleOut(user, itemId, dto.shopId);
  }
}
