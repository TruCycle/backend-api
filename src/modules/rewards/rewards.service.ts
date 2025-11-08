import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { User } from '../users/user.entity';
import { Claim } from '../claims/claim.entity';
import { LedgerEntry, LedgerEntryType, LedgerPurpose } from './ledger-entry.entity';
import { Wallet, WalletStatus } from './wallet.entity';
import { Item } from '../items/item.entity';

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(LedgerEntry) private readonly ledger: Repository<LedgerEntry>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private parseAmount(value: any, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private get currency(): string {
    const v = process.env.REWARDS_CURRENCY || 'PTS';
    return (v || 'PTS').toUpperCase().slice(0, 3);
  }

  private get collectorReward(): number {
    return this.parseAmount(process.env.REWARD_CLAIM_COLLECTOR, 10);
  }

  private get donorReward(): number {
    return this.parseAmount(process.env.REWARD_CLAIM_DONOR, 5);
  }

  async ensureWallet(manager: EntityManager, userId: string): Promise<Wallet> {
    const userRepo = manager.getRepository(User);
    const walletRepo = manager.getRepository(Wallet);

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) throw new Error('User not found for wallet');

    let wallet = await walletRepo.findOne({ where: { owner: { id: userId }, currency: this.currency } });
    if (wallet) return wallet;

    wallet = walletRepo.create({ owner: user, currency: this.currency, availableAmount: '0', pendingAmount: '0', status: WalletStatus.ACTIVE });
    wallet = await walletRepo.save(wallet);
    return wallet;
  }

  private add(a: string | number, b: string | number): string {
    const aa = Number(a);
    const bb = Number(b);
    return (Math.round((aa + bb) * 100) / 100).toFixed(2);
  }

  private sub(a: string | number, b: string | number): string {
    const aa = Number(a);
    const bb = Number(b);
    return (Math.round((aa - bb) * 100) / 100).toFixed(2);
  }

  async credit(
    manager: EntityManager,
    wallet: Wallet,
    amount: number,
    purpose: LedgerPurpose,
    ref: string,
  ): Promise<LedgerEntry | null> {
    const ledgerRepo = manager.getRepository(LedgerEntry);
    const walletRepo = manager.getRepository(Wallet);

    const amt = Math.max(0, Math.floor(amount * 100) / 100);
    if (amt <= 0) return null;

    const nextBalance = this.add(wallet.availableAmount, amt);
    const entry = ledgerRepo.create({
      wallet,
      type: LedgerEntryType.CREDIT,
      amount: amt.toFixed(2),
      currency: wallet.currency,
      balanceAfter: nextBalance,
      purpose,
      ref,
    });

    try {
      await ledgerRepo.save(entry);
      await walletRepo.update(wallet.id, { availableAmount: nextBalance });
      return entry;
    } catch (err: any) {
      // Unique violation => idempotent duplicate; treat as success
      if (err && (err.code === '23505' || String(err.message || '').includes('unique'))) {
        this.logger.debug(`Duplicate reward credit ignored (wallet=${wallet.id}, purpose=${purpose}, ref=${ref})`);
        return null;
      }
      throw err;
    }
  }

  // Ensure idempotent award on claim completion (works for both QR and manual flows)
  async awardOnClaimComplete(manager: EntityManager, claim: Claim): Promise<void> {
    const ref = claim.id;

    // Collector award
    if (claim.collector?.id) {
      const collectorWallet = await this.ensureWallet(manager, claim.collector.id);
      await this.credit(manager, collectorWallet, this.collectorReward, LedgerPurpose.CLAIM_COMPLETE_COLLECTOR, ref);
    }

    // Donor award (best-effort; donor may not be loaded on the claim in some flows)
    let donorId: string | null = claim.item?.donor?.id || null;
    if (!donorId && claim.item?.id) {
      try {
        const itemRepo = manager.getRepository(Item);
        const item = await itemRepo.findOne({ where: { id: claim.item.id }, relations: { donor: true } });
        donorId = item?.donor?.id || null;
      } catch {
        donorId = null;
      }
    }
    if (donorId) {
      const donorWallet = await this.ensureWallet(manager, donorId);
      await this.credit(manager, donorWallet, this.donorReward, LedgerPurpose.CLAIM_COMPLETE_DONOR, ref);
    }
  }
}
