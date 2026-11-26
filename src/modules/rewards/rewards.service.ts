import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { User } from '../users/user.entity';
import { Claim } from '../claims/claim.entity';
import { LedgerEntry, LedgerEntryType, LedgerPurpose } from './ledger-entry.entity';
import { Wallet, WalletStatus } from './wallet.entity';
import { Item } from '../items/item.entity';

@Injectable()
export class RewardsService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(LedgerEntry) private readonly ledger: Repository<LedgerEntry>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private parseAmount(value: any, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
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
    if (!manager.queryRunner?.isTransactionActive) {
      return manager.transaction(transaction => this.ensureWallet(transaction, userId));
    }
    const userRepo = manager.getRepository(User);
    const walletRepo = manager.getRepository(Wallet);

    // Serialize first-wallet creation on the stable owner row.
    const user = await userRepo.findOne({
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
      loadEagerRelations: false,
    });
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
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error('Reward credits require an active transaction');
    }
    const ledgerRepo = manager.getRepository(LedgerEntry);
    const walletRepo = manager.getRepository(Wallet);

    if (!Number.isFinite(amount)) return null;
    const amt = Math.max(0, Math.floor(amount * 100) / 100);
    if (amt <= 0) return null;
    const current = await walletRepo.findOne({ where: { id: wallet.id }, lock: { mode: 'pessimistic_write' } });
    if (!current || current.status !== WalletStatus.ACTIVE) throw new Error('Reward wallet unavailable');
    const nextBalance = this.add(current.availableAmount, amt);
    const entry = ledgerRepo.create({
      wallet,
      type: LedgerEntryType.CREDIT,
      amount: amt.toFixed(2),
      currency: current.currency,
      balanceAfter: nextBalance,
      purpose,
      ref,
    });

    // ON CONFLICT avoids leaving PostgreSQL's enclosing transaction aborted.
    const inserted = await ledgerRepo.createQueryBuilder().insert().into(LedgerEntry)
      .values(entry).orIgnore().returning('id').execute();
    if (!Array.isArray(inserted.raw) || inserted.raw.length === 0) return null;
    await walletRepo.update(wallet.id, { availableAmount: nextBalance });
    return entry;
  }

  // Ensure idempotent award on claim completion (works for both QR and manual flows)
  async awardOnClaimComplete(manager: EntityManager, claim: Claim): Promise<void> {
    const ref = claim.id;

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
    const awards = [
      { userId: claim.collector?.id, amount: this.collectorReward, purpose: LedgerPurpose.CLAIM_COMPLETE_COLLECTOR },
      { userId: donorId, amount: this.donorReward, purpose: LedgerPurpose.CLAIM_COMPLETE_DONOR },
    ].filter(award => Boolean(award.userId)).sort((left, right) => left.userId!.localeCompare(right.userId!));
    // Consistent owner lock order also covers reciprocal concurrent exchanges.
    for (const award of awards) {
      const wallet = await this.ensureWallet(manager, award.userId!);
      await this.credit(manager, wallet, award.amount, award.purpose, ref);
    }
  }
}
