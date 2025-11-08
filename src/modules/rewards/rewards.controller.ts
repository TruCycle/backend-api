import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Wallet } from './wallet.entity';
import { LedgerEntry } from './ledger-entry.entity';
import { RewardsService } from './rewards.service';

@ApiTags('rewards')
@Controller('rewards')
export class RewardsController {
  constructor(
    private readonly rewards: RewardsService,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(LedgerEntry) private readonly ledger: Repository<LedgerEntry>,
  ) {}

  @Get('wallet')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user wallet (auto-creates if absent)' })
  @ApiOkResponse({ description: 'Wallet view' })
  async getWallet(@Req() req: any) {
    const userId = req.user.id as string;
    const wallet = await this.rewards.ensureWallet(this.wallets.manager, userId);
    return {
      id: wallet.id,
      currency: wallet.currency,
      availableAmount: Number(wallet.availableAmount),
      pendingAmount: Number(wallet.pendingAmount),
      status: wallet.status,
      createdAt: wallet.createdAt,
    };
  }

  @Get('ledger')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List recent ledger entries for current user' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } })
  @ApiOkResponse({ description: 'Array of ledger entries' })
  async ledgerForUser(@Req() req: any, @Query('limit') limit?: string) {
    const userId = req.user.id as string;
    const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const wallet = await this.rewards.ensureWallet(this.ledger.manager, userId);
    const rows = await this.ledger.find({ where: { wallet: { id: wallet.id } }, order: { createdAt: 'DESC' }, take });
    return rows.map((e) => ({
      id: e.id,
      type: e.type,
      amount: Number(e.amount),
      currency: e.currency,
      balanceAfter: Number(e.balanceAfter),
      purpose: e.purpose,
      ref: e.ref,
      createdAt: e.createdAt,
    }));
  }
}

