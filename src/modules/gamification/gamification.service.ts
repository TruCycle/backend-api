import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { Claim, ClaimStatus } from '../claims/claim.entity';
import { FoundItem, FoundItemStatus } from '../found-items/found-item.entity';
import { FoundItemClaim, FoundItemClaimStatus } from '../found-items/found-item-claim.entity';
import { Item } from '../items/item.entity';
import { User } from '../users/user.entity';
import { GamificationBadge, GamificationBadgeCategory } from './badge.entity';
import { GamificationBadgeFilter, GamificationBadgesQueryDto } from './dto/gamification-badges-query.dto';
import { PointHistoryQueryDto } from './dto/point-history-query.dto';
import { PointTransaction } from './point-transaction.entity';
import { UserBadge } from './user-badge.entity';
import { UserProgress } from './user-progress.entity';
import { GamificationStreakType, UserStreak } from './user-streak.entity';

interface PointActivityInput {
  readonly userId: string;
  readonly points: number;
  readonly reason: string;
  readonly actionType: string;
  readonly actionId: string;
  readonly occurredAt: Date;
}

interface ProgressView {
  userId: string;
  totalPoints: number;
  currentLevel: number;
  pointsToNextLevel: number;
  levelProgressPercent: number;
}

const DEFAULT_POINT_HISTORY_LIMIT = 20;
const MAX_POINT_HISTORY_LIMIT = 100;
const DEFAULT_PAGE = 1;
const EXCHANGE_COMPLETE_COLLECTOR_POINTS = 60;
const EXCHANGE_COMPLETE_DONOR_POINTS = 45;
const FOUND_ITEM_POST_POINTS = 50;
const FOUND_ITEM_CLAIM_POINTS = 25;
const FOUND_ITEM_PICKED_UP_POINTS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Claim) private readonly claims: Repository<Claim>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(FoundItem) private readonly foundItems: Repository<FoundItem>,
    @InjectRepository(FoundItemClaim) private readonly foundItemClaims: Repository<FoundItemClaim>,
    @InjectRepository(UserProgress) private readonly progress: Repository<UserProgress>,
    @InjectRepository(UserStreak) private readonly streaks: Repository<UserStreak>,
    @InjectRepository(GamificationBadge) private readonly badges: Repository<GamificationBadge>,
    @InjectRepository(UserBadge) private readonly userBadges: Repository<UserBadge>,
    @InjectRepository(PointTransaction) private readonly pointTransactions: Repository<PointTransaction>,
  ) {}

  async getUserProgress(userId: string): Promise<ProgressView> {
    await this.backfillAndSync(userId);
    const progress = await this.ensureUserProgressRow(this.progress.manager, userId);
    return this.buildProgressView(progress.userId, progress.totalPoints);
  }

  async getUserStreaks(userId: string) {
    await this.backfillAndSync(userId);
    const rows = await this.getUserStreakRepository().find({
      where: { userId },
      order: { streakType: 'ASC' },
    });

    return rows
      .sort((left, right) => (left.streakType === GamificationStreakType.DAILY ? -1 : 1) - (right.streakType === GamificationStreakType.DAILY ? -1 : 1))
      .map((row) => ({
        userId: row.userId,
        currentStreak: row.currentStreak,
        longestStreak: row.longestStreak,
        lastActivityDate: row.lastActivityDate ? new Date(`${row.lastActivityDate}T00:00:00.000Z`).toISOString() : null,
        streakType: row.streakType,
        isActive: row.expiresAt ? row.expiresAt.getTime() > Date.now() : false,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      }));
  }

  async getUserBadges(userId: string, query: GamificationBadgesQueryDto) {
    await this.backfillAndSync(userId);
    const filter = query.filter ?? GamificationBadgeFilter.ALL;
    const activeBadges = await this.badges.find({
      where: query.category ? { isActive: true, category: query.category } : { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const earnedBadges = await this.userBadges.find({
      where: { userId },
      order: { earnedAt: 'DESC' },
    });

    const earnedBadgeMap = new Map(earnedBadges.map((entry) => [entry.badgeId, entry]));
    const badgeList = activeBadges.filter((badge) => {
      const isEarned = earnedBadgeMap.has(badge.id);
      if (filter === GamificationBadgeFilter.EARNED) {
        return isEarned;
      }
      if (filter === GamificationBadgeFilter.AVAILABLE) {
        return !isEarned;
      }
      return true;
    });

    return {
      badges: badgeList.map((badge) => this.mapBadge(badge)),
      earnedBadges: earnedBadges
        .filter((entry) => (query.category ? entry.badge.category === query.category : true))
        .map((entry) => ({
          badge: this.mapBadge(entry.badge),
          earnedAt: entry.earnedAt.toISOString(),
          isNew: !entry.isNotified,
        })),
    };
  }

  async getUserPointHistory(userId: string, query: PointHistoryQueryDto) {
    await this.backfillAndSync(userId);
    const page = Math.max(query.page ?? DEFAULT_PAGE, DEFAULT_PAGE);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_POINT_HISTORY_LIMIT, 1), MAX_POINT_HISTORY_LIMIT);
    const [transactions, total] = await this.pointTransactions.findAndCount({
      where: { userId },
      order: { occurredAt: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      transactions: transactions.map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        points: entry.points,
        reason: entry.reason,
        actionType: entry.actionType,
        actionId: entry.actionId ?? null,
        createdAt: entry.occurredAt.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async markBadgeSeen(userId: string, badgeId: string): Promise<void> {
    const normalizedBadgeId = badgeId.trim();
    if (!normalizedBadgeId) {
      throw new BadRequestException('Badge id is required');
    }

    await this.userBadges.update({ userId, badgeId: normalizedBadgeId }, { isNotified: true });
  }

  async recordExchangeCompleted(
    manager: EntityManager,
    userId: string,
    claimId: string,
    role: 'collector' | 'donor',
    occurredAt?: Date | null,
  ): Promise<void> {
    await this.recordActivity(manager, {
      userId,
      points: role === 'collector' ? EXCHANGE_COMPLETE_COLLECTOR_POINTS : EXCHANGE_COMPLETE_DONOR_POINTS,
      reason: role === 'collector' ? 'Completed an exchange' : 'Your exchange was completed',
      actionType: role === 'collector' ? 'exchange_complete_collector' : 'exchange_complete_donor',
      actionId: claimId,
      occurredAt: occurredAt ?? new Date(),
    });
  }

  async recordFoundItemPosted(userId: string, itemId: string, occurredAt?: Date | null): Promise<void> {
    await this.recordActivity(this.pointTransactions.manager, {
      userId,
      points: FOUND_ITEM_POST_POINTS,
      reason: 'Posted a found item',
      actionType: 'found_item_posted',
      actionId: itemId,
      occurredAt: occurredAt ?? new Date(),
    });
  }

  async recordFoundItemClaimed(userId: string, claimId: string, occurredAt?: Date | null): Promise<void> {
    await this.recordActivity(this.pointTransactions.manager, {
      userId,
      points: FOUND_ITEM_CLAIM_POINTS,
      reason: 'Claimed a found item',
      actionType: 'found_item_claimed',
      actionId: claimId,
      occurredAt: occurredAt ?? new Date(),
    });
  }

  async recordFoundItemPickedUp(userId: string, itemId: string, occurredAt?: Date | null): Promise<void> {
    await this.recordActivity(this.pointTransactions.manager, {
      userId,
      points: FOUND_ITEM_PICKED_UP_POINTS,
      reason: 'Marked a found item as picked up',
      actionType: 'found_item_picked_up',
      actionId: itemId,
      occurredAt: occurredAt ?? new Date(),
    });
  }

  private getUserProgressRepository(manager?: EntityManager): Repository<UserProgress> {
    return manager ? manager.getRepository(UserProgress) : this.progress;
  }

  private getUserStreakRepository(manager?: EntityManager): Repository<UserStreak> {
    return manager ? manager.getRepository(UserStreak) : this.streaks;
  }

  private getUserBadgeRepository(manager?: EntityManager): Repository<UserBadge> {
    return manager ? manager.getRepository(UserBadge) : this.userBadges;
  }

  private getPointTransactionRepository(manager?: EntityManager): Repository<PointTransaction> {
    return manager ? manager.getRepository(PointTransaction) : this.pointTransactions;
  }

  private getFoundItemRepository(manager?: EntityManager): Repository<FoundItem> {
    return manager ? manager.getRepository(FoundItem) : this.foundItems;
  }

  private getFoundItemClaimRepository(manager?: EntityManager): Repository<FoundItemClaim> {
    return manager ? manager.getRepository(FoundItemClaim) : this.foundItemClaims;
  }

  private getClaimRepository(manager?: EntityManager): Repository<Claim> {
    return manager ? manager.getRepository(Claim) : this.claims;
  }

  private getBadgeRepository(manager?: EntityManager): Repository<GamificationBadge> {
    return manager ? manager.getRepository(GamificationBadge) : this.badges;
  }

  private async recordActivity(manager: EntityManager, input: PointActivityInput): Promise<void> {
    await this.createPointTransaction(manager, input);
    await this.syncUserState(manager, input.userId);
  }

  private async backfillAndSync(userId: string): Promise<void> {
    await this.dedupeTrackedPointTransactions(this.pointTransactions.manager, userId);
    await this.backfillHistoricalActivity(this.pointTransactions.manager, userId);
    await this.syncUserState(this.pointTransactions.manager, userId);
  }

  private async dedupeTrackedPointTransactions(manager: EntityManager, userId: string): Promise<void> {
    const repo = this.getPointTransactionRepository(manager);
    const transactions = await repo.find({
      where: { userId },
      order: { occurredAt: 'ASC', createdAt: 'ASC' },
    });

    const seenKeys = new Set<string>();
    const duplicateIds: string[] = [];

    for (const transaction of transactions) {
      if (!transaction.actionId) {
        continue;
      }

      const dedupeKey = `${transaction.actionType}:${transaction.actionId}`;
      if (seenKeys.has(dedupeKey)) {
        duplicateIds.push(transaction.id);
        continue;
      }

      seenKeys.add(dedupeKey);
    }

    if (duplicateIds.length > 0) {
      await repo.delete(duplicateIds);
    }
  }

  private async backfillHistoricalActivity(manager: EntityManager, userId: string): Promise<void> {
    const claimRepo = this.getClaimRepository(manager);
    const foundItemRepo = this.getFoundItemRepository(manager);
    const foundItemClaimRepo = this.getFoundItemClaimRepository(manager);

    const collectorClaims = await claimRepo
      .createQueryBuilder('claim')
      .leftJoin('claim.collector', 'collector')
      .where('collector.id = :userId', { userId })
      .andWhere('claim.status = :status', { status: ClaimStatus.COMPLETE })
      .getMany();

    for (const claim of collectorClaims) {
      await this.createPointTransaction(manager, {
        userId,
        points: EXCHANGE_COMPLETE_COLLECTOR_POINTS,
        reason: 'Completed an exchange',
        actionType: 'exchange_complete_collector',
        actionId: claim.id,
        occurredAt: claim.completedAt ?? claim.updatedAt ?? claim.createdAt,
      });
    }

    const donorClaims = await claimRepo
      .createQueryBuilder('claim')
      .leftJoin('claim.item', 'item')
      .leftJoin('item.donor', 'donor')
      .where('donor.id = :userId', { userId })
      .andWhere('claim.status = :status', { status: ClaimStatus.COMPLETE })
      .getMany();

    for (const claim of donorClaims) {
      await this.createPointTransaction(manager, {
        userId,
        points: EXCHANGE_COMPLETE_DONOR_POINTS,
        reason: 'Your exchange was completed',
        actionType: 'exchange_complete_donor',
        actionId: claim.id,
        occurredAt: claim.completedAt ?? claim.updatedAt ?? claim.createdAt,
      });
    }

    const postedItems = await foundItemRepo.find({ where: { posterId: userId } });
    for (const item of postedItems) {
      await this.createPointTransaction(manager, {
        userId,
        points: FOUND_ITEM_POST_POINTS,
        reason: 'Posted a found item',
        actionType: 'found_item_posted',
        actionId: item.id,
        occurredAt: item.postedAt ?? item.createdAt,
      });
      if (item.status === FoundItemStatus.PICKED_UP) {
        await this.createPointTransaction(manager, {
          userId,
          points: FOUND_ITEM_PICKED_UP_POINTS,
          reason: 'Marked a found item as picked up',
          actionType: 'found_item_picked_up',
          actionId: item.id,
          occurredAt: item.updatedAt ?? item.postedAt ?? item.createdAt,
        });
      }
    }

    const claims = await foundItemClaimRepo
      .createQueryBuilder('claim')
      .where('claim.claimer_id = :userId', { userId })
      .andWhere('claim.status <> :status', { status: FoundItemClaimStatus.CANCELLED })
      .getMany();

    for (const claim of claims) {
      await this.createPointTransaction(manager, {
        userId,
        points: FOUND_ITEM_CLAIM_POINTS,
        reason: 'Claimed a found item',
        actionType: 'found_item_claimed',
        actionId: claim.id,
        occurredAt: claim.createdAt,
      });
    }
  }

  private async createPointTransaction(manager: EntityManager, input: PointActivityInput): Promise<void> {
    const repo = this.getPointTransactionRepository(manager);

    const existing = await repo.findOne({
      where: {
        userId: input.userId,
        actionType: input.actionType,
        actionId: input.actionId,
      },
    });
    if (existing) {
      return;
    }

    try {
      await repo.save(
        repo.create({
          userId: input.userId,
          points: input.points,
          reason: input.reason,
          actionType: input.actionType,
          actionId: input.actionId,
          occurredAt: input.occurredAt,
        }),
      );
    } catch (error: any) {
      if (error?.code === '23505' || String(error?.message || '').toLowerCase().includes('unique')) {
        return;
      }
      throw error;
    }
  }

  private async syncUserState(manager: EntityManager, userId: string): Promise<void> {
    await this.ensureUserProgressRow(manager, userId);
    await this.ensureStreakRows(manager, userId);
    await this.syncUserProgress(manager, userId);
    await this.syncUserStreaks(manager, userId);
    await this.syncUserBadges(manager, userId);
  }

  private async ensureUserProgressRow(manager: EntityManager, userId: string): Promise<UserProgress> {
    const progressRepo = this.getUserProgressRepository(manager);
    let row = await progressRepo.findOne({ where: { userId } });
    if (row) {
      return row;
    }

    const user = await manager.getRepository(User).findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    row = progressRepo.create({ userId, user, totalPoints: 0, currentLevel: 1 });
    return progressRepo.save(row);
  }

  private async ensureStreakRows(manager: EntityManager, userId: string): Promise<void> {
    const streakRepo = this.getUserStreakRepository(manager);
    const user = await manager.getRepository(User).findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const rows = await streakRepo.find({ where: { userId } });
    const existing = new Set(rows.map((row) => row.streakType));
    for (const streakType of [GamificationStreakType.DAILY, GamificationStreakType.WEEKLY]) {
      if (existing.has(streakType)) {
        continue;
      }
      await streakRepo.save(
        streakRepo.create({
          userId,
          user,
          streakType,
          currentStreak: 0,
          longestStreak: 0,
          lastActivityDate: null,
          expiresAt: null,
        }),
      );
    }
  }

  private async syncUserProgress(manager: EntityManager, userId: string): Promise<void> {
    const progressRepo = this.getUserProgressRepository(manager);
    const row = await this.ensureUserProgressRow(manager, userId);
    const raw = await this.getPointTransactionRepository(manager)
      .createQueryBuilder('transaction')
      .select('COALESCE(SUM(transaction.points), 0)', 'total')
      .where('transaction.user_id = :userId', { userId })
      .getRawOne<{ total: string }>();

    const totalPoints = Number(raw?.total ?? 0);
    const currentLevel = this.resolveCurrentLevel(totalPoints);
    row.totalPoints = totalPoints;
    row.currentLevel = currentLevel;
    await progressRepo.save(row);
  }

  private async syncUserStreaks(manager: EntityManager, userId: string): Promise<void> {
    const streakRepo = this.getUserStreakRepository(manager);
    const rows = await streakRepo.find({ where: { userId } });
    const transactions = await this.getPointTransactionRepository(manager).find({
      where: { userId },
      order: { occurredAt: 'ASC' },
    });

    const dayKeys = Array.from(new Set(transactions.map((entry) => this.toUtcDateKey(entry.occurredAt))));
    const weekKeys = Array.from(new Set(transactions.map((entry) => this.toUtcDateKey(this.startOfUtcWeek(entry.occurredAt)))));

    const dailyStats = this.computeStreakStats(dayKeys, 'daily');
    const weeklyStats = this.computeStreakStats(weekKeys, 'weekly');

    for (const row of rows) {
      const stats = row.streakType === GamificationStreakType.DAILY ? dailyStats : weeklyStats;
      row.currentStreak = stats.currentStreak;
      row.longestStreak = stats.longestStreak;
      row.lastActivityDate = stats.lastActivityDate;
      row.expiresAt = stats.expiresAt;
      await streakRepo.save(row);
    }
  }

  private async syncUserBadges(manager: EntityManager, userId: string): Promise<void> {
    const badgeRepo = this.getBadgeRepository(manager);
    const userBadgeRepo = this.getUserBadgeRepository(manager);
    const activeBadges = await badgeRepo.find({ where: { isActive: true } });
    if (activeBadges.length === 0) {
      return;
    }

    const earnedIds = new Set(
      (await userBadgeRepo.find({ where: { userId } })).map((entry) => entry.badgeId),
    );
    const eligibleBadgeIds = await this.resolveEligibleBadgeIds(manager, userId);

    for (const badge of activeBadges) {
      if (!eligibleBadgeIds.has(badge.id) || earnedIds.has(badge.id)) {
        continue;
      }
      await userBadgeRepo.save(
        userBadgeRepo.create({
          userId,
          badgeId: badge.id,
          isNotified: false,
        }),
      );
    }
  }

  private async resolveEligibleBadgeIds(manager: EntityManager, userId: string): Promise<Set<string>> {
    const eligible = new Set<string>();
    const completedExchangeCount = await this.getClaimRepository(manager)
      .createQueryBuilder('claim')
      .leftJoin('claim.collector', 'collector')
      .leftJoin('claim.item', 'item')
      .leftJoin('item.donor', 'donor')
      .where('claim.status = :status', { status: ClaimStatus.COMPLETE })
      .andWhere('(collector.id = :userId OR donor.id = :userId)', { userId })
      .getCount();

    const foundPostsCount = await this.getFoundItemRepository(manager).count({ where: { posterId: userId } });
    const foundPickedUpCount = await this.getFoundItemRepository(manager).count({
      where: { posterId: userId, status: FoundItemStatus.PICKED_UP },
    });
    const foundClaimsCount = await this.getFoundItemClaimRepository(manager)
      .createQueryBuilder('claim')
      .where('claim.claimer_id = :userId', { userId })
      .andWhere('claim.status <> :status', { status: FoundItemClaimStatus.CANCELLED })
      .getCount();

    const impactRaw = await manager
      .getRepository(Item)
      .createQueryBuilder('item')
      .select('COALESCE(SUM(item.estimated_co2_saved_kg), 0)', 'total')
      .leftJoin(Claim, 'claim', 'claim.item_id = item.id')
      .leftJoin('item.donor', 'donor')
      .leftJoin('claim.collector', 'collector')
      .where('claim.status = :status', { status: ClaimStatus.COMPLETE })
      .andWhere('(donor.id = :userId OR collector.id = :userId)', { userId })
      .getRawOne<{ total: string }>();
    const totalImpact = Number(impactRaw?.total ?? 0);

    const dailyStreak = await this.getUserStreakRepository(manager).findOne({
      where: { userId, streakType: GamificationStreakType.DAILY },
    });

    if (completedExchangeCount >= 1) {
      eligible.add('first-steps');
    }
    if ((dailyStreak?.currentStreak ?? 0) >= 3 || (dailyStreak?.longestStreak ?? 0) >= 3) {
      eligible.add('warming-up');
    }
    if (totalImpact >= 10) {
      eligible.add('earth-saver');
    }
    if (foundPostsCount >= 1) {
      eligible.add('good-samaritan');
    }
    if (foundPickedUpCount >= 5) {
      eligible.add('community-helper');
    }
    if (completedExchangeCount >= 1 && foundPostsCount >= 1 && foundClaimsCount >= 1) {
      eligible.add('app-explorer');
    }

    return eligible;
  }

  private buildProgressView(userId: string, totalPoints: number): ProgressView {
    const currentLevel = this.resolveCurrentLevel(totalPoints);
    const currentFloor = this.pointsRequiredToReachLevel(currentLevel);
    const nextFloor = this.pointsRequiredToReachLevel(currentLevel + 1);
    const range = Math.max(1, nextFloor - currentFloor);
    const levelProgressPercent = Math.max(
      0,
      Math.min(100, Math.round(((totalPoints - currentFloor) / range) * 100)),
    );

    return {
      userId,
      totalPoints,
      currentLevel,
      pointsToNextLevel: Math.max(0, nextFloor - totalPoints),
      levelProgressPercent,
    };
  }

  private resolveCurrentLevel(totalPoints: number): number {
    let level = 1;
    while (this.pointsRequiredToReachLevel(level + 1) <= totalPoints) {
      level += 1;
      if (level >= 1000) {
        break;
      }
    }
    return level;
  }

  private pointsRequiredToReachLevel(level: number): number {
    if (level <= 1) {
      return 0;
    }

    let total = 0;
    for (let currentLevel = 1; currentLevel < level; currentLevel += 1) {
      total += 100 + (currentLevel - 1) * 50;
    }
    return total;
  }

  private mapBadge(badge: GamificationBadge) {
    return {
      id: badge.id,
      name: badge.name,
      description: badge.description,
      category: badge.category,
      rarity: badge.rarity,
      iconUrl: badge.iconUrl ?? '',
      requirement: badge.requirement,
      pointsAwarded: badge.pointsAwarded,
    };
  }

  private toUtcDateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private startOfUtcWeek(value: Date): Date {
    const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    const day = date.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + diff);
    return date;
  }

  private parseUtcDateKey(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private computeStreakStats(keys: string[], cadence: 'daily' | 'weekly') {
    if (keys.length === 0) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastActivityDate: null as string | null,
        expiresAt: null as Date | null,
      };
    }

    let longestStreak = 1;
    let currentRun = 1;
    let latestRun = 1;

    for (let index = 1; index < keys.length; index += 1) {
      const previous = this.parseUtcDateKey(keys[index - 1]).getTime();
      const current = this.parseUtcDateKey(keys[index]).getTime();
      const expectedStep = cadence === 'daily' ? DAY_IN_MS : 7 * DAY_IN_MS;
      if (current - previous === expectedStep) {
        currentRun += 1;
      } else {
        longestStreak = Math.max(longestStreak, currentRun);
        currentRun = 1;
      }
      if (index === keys.length - 1) {
        latestRun = currentRun;
      }
    }

    longestStreak = Math.max(longestStreak, currentRun);
    const lastActivityDate = keys[keys.length - 1];
    const lastActivity = this.parseUtcDateKey(lastActivityDate);
    const expiresAt = new Date(lastActivity.getTime() + (cadence === 'daily' ? 2 : 14) * DAY_IN_MS);

    return {
      currentStreak: latestRun,
      longestStreak,
      lastActivityDate,
      expiresAt,
    };
  }
}
