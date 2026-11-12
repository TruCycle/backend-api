import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, MoreThan, Not, Repository } from 'typeorm';

import { normalizePostcode, resolveOutwardPostcode } from '../../common/utils/postcode';
import { projectFoundItemLocation, publicLocationPoint, validLocationPoint } from '../../common/utils/public-location';
import { safeFailure } from '../../common/utils/safe-log';
import { GamificationService } from '../gamification/gamification.service';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { User, UserStatus } from '../users/user.entity';

import { CreateFoundItemClaimDto } from './dto/create-found-item-claim.dto';
import { CreateFoundItemDto, CreateFoundItemImageDto } from './dto/create-found-item.dto';
import { MyFoundItemsQueryDto } from './dto/my-found-items-query.dto';
import { ObserveFoundItemDto } from './dto/observe-found-item.dto';
import { FOUND_ITEM_REPORT_REASONS, ReportFoundItemDto } from './dto/report-found-item.dto';
import { SearchFoundItemCatalogDto } from './dto/search-found-item-catalog.dto';
import { FoundItemSortBy, SearchFoundItemsDto } from './dto/search-found-items.dto';
import { UpdateFoundItemStatusDto } from './dto/update-found-item-status.dto';
import {
  findFoundItemCarbonCatalogEntry,
  findFoundItemCarbonCatalogEntryBySelection,
  getFoundItemCarbonCatalogSupportedCategories,
  searchFoundItemCarbonCatalog,
  type FoundItemCarbonCatalogEntry,
} from './found-item-carbon-catalog';
import { FoundItemClaim, FoundItemClaimStatus } from './found-item-claim.entity';
import { FoundItemObservation } from './found-item-observation.entity';
import { FoundItemReport } from './found-item-report.entity';
import { FoundItem, FoundItemImage, FoundItemStatus } from './found-item.entity';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_PAGE = 1;
// Real names and email-derived labels stay private until optional display names exist.
const PUBLIC_ACTOR_LABEL = 'Community member';
const ACTIVE_CLAIM_STATUSES: readonly FoundItemClaimStatus[] = [FoundItemClaimStatus.PENDING, FoundItemClaimStatus.ACKNOWLEDGED];
const FOUND_ITEM_FALLBACK_IMPACT_FACTORS: Record<string, { defaultWeightKg: number; impactFactor: number }> = {
  furniture: { defaultWeightKg: 25, impactFactor: 3.44 },
  electronics: { defaultWeightKg: 12, impactFactor: 5.1 },
  clothing: { defaultWeightKg: 6, impactFactor: 2.2 },
  books: { defaultWeightKg: 14, impactFactor: 1.8 },
  appliances: { defaultWeightKg: 35, impactFactor: 4.2 },
  outdoor: { defaultWeightKg: 18, impactFactor: 3 },
  toys: { defaultWeightKg: 8, impactFactor: 2.6 },
  other: { defaultWeightKg: 15, impactFactor: 2.8 },
};

interface ResolvedFoundItemLocation {
  readonly postcode: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly address: string | null;
  readonly neighborhood: string | null;
}

@Injectable()
export class FoundItemsService {
  private transactionScoped = false;
  private afterCommit: (() => Promise<void>)[] = [];
  // Reviewable QA proposal defaults; activation is separately gated.
  readonly lifecyclePolicy = { nearbyKm: 5, closedHours: 24, expiryHours: 168, nudgeHours: 72 };
  private readonly logger = new Logger(FoundItemsService.name);

  constructor(
    @InjectRepository(FoundItem) private readonly foundItems: Repository<FoundItem>,
    @InjectRepository(FoundItemClaim) private readonly claims: Repository<FoundItemClaim>,
    @InjectRepository(FoundItemReport) private readonly reports: Repository<FoundItemReport>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly geocoding: ItemGeocodingService,
    private readonly notifications: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly gamification: GamificationService,
    @InjectRepository(FoundItemObservation) private readonly observations: Repository<FoundItemObservation>,
  ) {}

  configureLifecyclePolicy(policy: Partial<FoundItemsService['lifecyclePolicy']>): void {
    for (const [key, value] of Object.entries(policy)) {
      if (!(key in this.lifecyclePolicy) || !Number.isFinite(value) || value <= 0) {
        throw new BadRequestException('Lifecycle policy values must be positive finite numbers');
      }
    }
    Object.assign(this.lifecyclePolicy, policy);
  }

  async list(userId: string, query: SearchFoundItemsDto) {
    const page = Math.max(query.page ?? DEFAULT_PAGE, DEFAULT_PAGE);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const status = query.status ?? FoundItemStatus.AVAILABLE;
    const postcodeArea = query.postcode === undefined ? null : resolveOutwardPostcode(query.postcode);
    if (query.postcode !== undefined && !postcodeArea) {
      throw new BadRequestException('Enter a valid postcode or postcode area');
    }

    const qb = this.foundItems
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.poster', 'poster')
      .where(query.includeRecentClosed && query.status === undefined
        ? '(item.status IN (:...activeStatuses) OR (item.status IN (:...closedStatuses) AND item.closed_at >= :closedSince))'
        : 'item.status = :status', {
        status, activeStatuses: [FoundItemStatus.AVAILABLE, FoundItemStatus.CLAIMED],
        closedStatuses: [FoundItemStatus.PICKED_UP, FoundItemStatus.GONE, FoundItemStatus.EXPIRED],
        closedSince: new Date(Date.now() - this.lifecyclePolicy.closedHours * 3600000),
      });

    if (query.category) {
      qb.andWhere('LOWER(item.category) = LOWER(:category)', { category: query.category });
    }
    // Do not let exact/postcode-prefix matching become a public membership oracle.
    // This flow already materialises rows before distance filtering/pagination.
    const rows = await qb.getMany();
    const items = postcodeArea && query.maxDistance === undefined ? rows.filter((item) => resolveOutwardPostcode(item.postcode) === postcodeArea) : rows;
    const claimCounts = await this.loadClaimCounts(items.map((item) => item.id));
    const origin = await this.resolveOrigin(query);
    if (!origin && (query.maxDistance !== undefined || query.sortBy === FoundItemSortBy.NEAREST)) {
      throw new BadRequestException('Provide a search location for distance filtering or nearest sorting');
    }
    const mappedItems = items.map((item) => this.mapFoundItem(item, claimCounts.get(item.id) ?? 0, origin));
    const filteredItems = mappedItems.filter((item) => {
      if (!origin || query.maxDistance === undefined) {
        return true;
      }
      if (item.location.approximateDistance === null) {
        return false;
      }
      return item.location.approximateDistance <= query.maxDistance;
    });
    const sortedItems = this.sortItems(filteredItems, query.sortBy ?? FoundItemSortBy.NEWEST);
    const total = sortedItems.length;
    const pagedItems = sortedItems.slice((page - 1) * limit, page * limit);

    return {
      items: pagedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async searchCatalog(query: SearchFoundItemCatalogDto) {
    const entries = searchFoundItemCarbonCatalog({
      category: query.category,
      search: query.search,
      limit: query.limit,
    });

    return {
      supportedCategories: getFoundItemCarbonCatalogSupportedCategories(),
      entries: entries.map((entry) => this.mapCatalogEntry(entry)),
    };
  }

  async getById(userId: string, foundItemId: string) {
    const item = await this.foundItems.findOne({
      where: { id: foundItemId.trim() },
      relations: { poster: true },
    });
    if (!item) {
      throw new NotFoundException('Found item not found');
    }

    if (item.posterId !== userId) {
      await this.foundItems.increment({ id: item.id }, 'viewCount', 1);
      item.viewCount += 1;
    }

    const claimCounts = await this.loadClaimCounts([item.id]);
    const claims = item.posterId === userId ? await this.claims.find({
      where: { foundItemId: item.id },
      relations: { claimer: true },
      order: { createdAt: 'DESC' },
    }) : [];
    const viewerClaim = item.posterId !== userId ? await this.claims.findOne({
      where: { foundItemId: item.id, claimerId: userId },
      relations: { claimer: true },
      order: { createdAt: 'DESC' },
    }) : null;

    return {
      item: this.mapFoundItem(item, claimCounts.get(item.id) ?? 0, null, userId),
      claims: claims.map((claim) => ({
        id: claim.id,
        foundItemId: claim.foundItemId,
        claimerId: claim.claimerId,
        claimerName: PUBLIC_ACTOR_LABEL,
        message: claim.message ?? null,
        status: claim.status,
        createdAt: claim.createdAt.toISOString(),
      })),
      viewerClaim:
        viewerClaim && viewerClaim.status !== FoundItemClaimStatus.CANCELLED
          ? {
              id: viewerClaim.id,
              foundItemId: viewerClaim.foundItemId,
              claimerId: viewerClaim.claimerId,
              claimerName: PUBLIC_ACTOR_LABEL,
              message: viewerClaim.message ?? null,
              status: viewerClaim.status,
              createdAt: viewerClaim.createdAt.toISOString(),
            }
          : null,
    };
  }

  async listMine(userId: string, query: MyFoundItemsQueryDto) {
    const page = Math.max(query.page ?? DEFAULT_PAGE, DEFAULT_PAGE);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const qb = this.foundItems
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.poster', 'poster')
      .where('item.poster_id = :userId', { userId });

    if (query.status) {
      qb.andWhere('item.status = :status', { status: query.status });
    }

    qb.orderBy('item.posted_at', 'DESC');
    const items = await qb.getMany();
    const claimCounts = await this.loadClaimCounts(items.map((item) => item.id));
    const total = items.length;
    const pagedItems = items.slice((page - 1) * limit, page * limit);

    return {
      items: pagedItems.map((item) => this.mapFoundItem(item, claimCounts.get(item.id) ?? 0, null, userId)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async create(userId: string, dto: CreateFoundItemDto) {
    const poster = await this.ensureActiveUser(userId);
    const location = await this.resolveLocation(dto, poster);
    const impact = this.resolveImpact(dto.category, dto.title, dto.weightKg, dto.carbonCatalogSelection);
    const item = this.foundItems.create({
      posterId: poster.id,
      poster,
      title: dto.title.trim(),
      description: dto.description.trim(),
      category: dto.category,
      condition: dto.condition?.trim() || null,
      weightKg: impact.weightKg,
      estimatedCo2eKg: impact.estimatedCo2eKg,
      impactPoints: impact.impactPoints,
      isFlyTipped: dto.isFlyTipped === true,
      status: FoundItemStatus.AVAILABLE,
      address: location.address,
      neighborhood: location.neighborhood,
      postcode: location.postcode,
      latitude: location.latitude,
      longitude: location.longitude,
      images: this.normalizeImages(dto.images),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + this.lifecyclePolicy.expiryHours * 3600000),
    });

    const saved = await this.foundItems.save(item);
    try {
      await this.gamification.recordFoundItemPosted(poster.id, saved.id, saved.postedAt);
    } catch (error) {
      this.logger.warn(safeFailure('found-item.post.activity', error));
    }

    return { item: this.mapFoundItem(saved, 0, null, userId) };
  }

  async updateStatus(userId: string, foundItemId: string, dto: UpdateFoundItemStatusDto): Promise<{ item: ReturnType<FoundItemsService['mapFoundItem']> }> {
    if (!this.transactionScoped) return this.withItemLock(foundItemId, (scoped) => scoped.updateStatus(userId, foundItemId, dto));
    const item = await this.foundItems.findOne({
      where: { id: foundItemId.trim() },
      relations: { poster: true },
    });
    if (!item) {
      throw new NotFoundException('Found item not found');
    }
    if (item.posterId !== userId) {
      throw new ForbiddenException('Only the poster can update this found item');
    }
    if (dto.status === FoundItemStatus.REPORTED || dto.status === FoundItemStatus.CLAIMED) {
      throw new BadRequestException('This status cannot be set directly');
    }

    // Repeated requests must not repeat rewards, claim completion or public events.
    if (item.status === dto.status) {
      const counts = await this.loadClaimCounts([item.id]);
      return { item: this.mapFoundItem(item, counts.get(item.id) ?? 0, null, userId) };
    }
    if (dto.status === FoundItemStatus.AVAILABLE && (item.status === FoundItemStatus.GONE || item.status === FoundItemStatus.EXPIRED)) {
      return this.reconfirm(userId, foundItemId);
    }
    if (item.status === FoundItemStatus.PICKED_UP || item.status === FoundItemStatus.REPORTED) {
      throw new BadRequestException('This closed found item cannot be changed directly');
    }
    if (dto.status === FoundItemStatus.PICKED_UP && (item.status === FoundItemStatus.EXPIRED || item.status === FoundItemStatus.GONE)) {
      throw new BadRequestException('Reconfirm availability before recording a pickup');
    }

    const activeClaims = await this.claims.find({ where: { foundItemId: item.id } });

    if (dto.status === FoundItemStatus.PICKED_UP) {
      const [firstClaim, ...remainingClaims] = activeClaims.filter((claim) => ACTIVE_CLAIM_STATUSES.includes(claim.status));
      if (firstClaim) {
        firstClaim.status = FoundItemClaimStatus.COMPLETED;
        await this.claims.save(firstClaim);
      }
      for (const claim of remainingClaims) {
        claim.status = FoundItemClaimStatus.CANCELLED;
        await this.claims.save(claim);
      }
      try {
        this.afterCommit.push(async () => { await this.gamification.recordFoundItemPickedUp(userId, item.id, new Date()); });
      } catch (error) {
        this.logger.warn(safeFailure('found-item.pickup.activity', error));
      }
    }

    if (dto.status === FoundItemStatus.AVAILABLE || dto.status === FoundItemStatus.EXPIRED || dto.status === FoundItemStatus.GONE) {
      for (const claim of activeClaims.filter((currentClaim) => ACTIVE_CLAIM_STATUSES.includes(currentClaim.status))) {
        claim.status = FoundItemClaimStatus.CANCELLED;
        await this.claims.save(claim);
      }
    }

    item.status = dto.status;
    item.closedAt = [FoundItemStatus.PICKED_UP, FoundItemStatus.EXPIRED, FoundItemStatus.GONE].includes(dto.status) ? new Date() : null;
    const saved = await this.foundItems.save(item);
    const claimCount = await this.loadClaimCounts([saved.id]);

    if (dto.status === FoundItemStatus.PICKED_UP) {
      try {
        this.afterCommit.push(async () => { await this.notificationsGateway.broadcastRescue('rescue', {
          id: saved.id,
          title: saved.title,
          category: saved.category,
          postcode: resolveOutwardPostcode(saved.postcode) ?? '',
          co2eKg: Number(saved.estimatedCo2eKg ?? 0),
          impactPoints: Number(saved.impactPoints ?? 0),
          rescuerName: PUBLIC_ACTOR_LABEL,
          imageUrl: saved.images?.[0]?.url ?? null,
        }); });
      } catch (error) {
        this.logger.warn(safeFailure('found-item.rescue.broadcast', error));
      }
    }

    return { item: this.mapFoundItem(saved, claimCount.get(saved.id) ?? 0, null, userId) };
  }

  async remove(userId: string, foundItemId: string): Promise<void> {
    if (!this.transactionScoped) return this.withItemLock(foundItemId, (scoped) => scoped.remove(userId, foundItemId));
    const item = await this.foundItems.findOne({ where: { id: foundItemId.trim() } });
    if (!item) {
      throw new NotFoundException('Found item not found');
    }
    if (item.posterId !== userId) {
      throw new ForbiddenException('Only the poster can delete this found item');
    }

    const claims = await this.claims.find({ where: { foundItemId: item.id } });
    if (claims.some((claim) => ACTIVE_CLAIM_STATUSES.includes(claim.status))) {
      throw new BadRequestException('Close the found item before deleting a post with active requests');
    }
    await this.foundItems.delete(item.id);
  }

  async claim(userId: string, foundItemId: string, dto: CreateFoundItemClaimDto): Promise<{ claim: {id: string; foundItemId: string; claimerId: string; claimerName: string; message: string | null; status: FoundItemClaimStatus; createdAt: string} }> {
    if (!this.transactionScoped) return this.withItemLock(foundItemId, (scoped) => scoped.claim(userId, foundItemId, dto));
    const claimer = await this.ensureActiveUser(userId);
    const item = await this.foundItems.findOne({
      where: { id: foundItemId.trim() },
      relations: { poster: true },
    });
    if (!item) {
      throw new NotFoundException('Found item not found');
    }
    if (item.posterId === userId) {
      throw new ForbiddenException('You cannot claim your own found item');
    }
    if (item.status !== FoundItemStatus.AVAILABLE || (item.expiresAt && item.expiresAt <= new Date())) {
      throw new BadRequestException('This found item is no longer available');
    }

    const existingClaim = await this.claims.findOne({ where: { foundItemId: item.id, claimerId: userId } });
    if (existingClaim && existingClaim.status !== FoundItemClaimStatus.CANCELLED) {
      throw new BadRequestException('You have already claimed this item');
    }

    const claim = this.claims.create({
      ...(existingClaim ? { id: existingClaim.id } : {}),
      foundItemId: item.id,
      foundItem: item,
      claimerId: claimer.id,
      claimer,
      message: dto.message?.trim() || null,
      status: FoundItemClaimStatus.PENDING,
    });
    const savedClaim = await this.claims.save(claim);
    item.status = FoundItemStatus.CLAIMED;
    await this.foundItems.save(item);

    try {
      this.afterCommit.push(async () => { await this.gamification.recordFoundItemClaimed(userId, savedClaim.id, savedClaim.createdAt); });
    } catch (error) {
      this.logger.warn(safeFailure('found-item.claim.activity', error));
    }

    try {
      this.afterCommit.push(async () => { await this.notifications.createAndEmit(
        item.posterId,
        'general',
        'Found item interest',
        `${PUBLIC_ACTOR_LABEL} wants to pick up “${item.title}”.`,
        { foundItemId: item.id, claimId: savedClaim.id },
      ); });
    } catch {
      // Interest remains recorded if the optional notification fails.
    }

    return {
      claim: {
        id: savedClaim.id,
        foundItemId: savedClaim.foundItemId,
        claimerId: savedClaim.claimerId,
        claimerName: PUBLIC_ACTOR_LABEL,
        message: savedClaim.message ?? null,
        status: savedClaim.status,
        createdAt: savedClaim.createdAt.toISOString(),
      },
    };
  }

  async acknowledgeClaim(userId: string, id: string, claimId: string): Promise<{ success: boolean }> {
    if (!this.transactionScoped) return this.withItemLock(id, (scoped) => scoped.acknowledgeClaim(userId, id, claimId));
    const item = await this.foundItems.findOne({ where: { id: id.trim() } });
    if (!item) throw new NotFoundException('Found item not found');
    if (item.posterId !== userId) throw new ForbiddenException('Only the poster can acknowledge a pickup request');
    if (item.status !== FoundItemStatus.CLAIMED) throw new BadRequestException('This spot has no active pickup request');
    const claim = await this.claims.findOne({ where: { id: claimId.trim(), foundItemId: item.id } });
    if (!claim || !ACTIVE_CLAIM_STATUSES.includes(claim.status)) throw new BadRequestException('This pickup request is not active');
    if (claim.status !== FoundItemClaimStatus.ACKNOWLEDGED) {
      claim.status = FoundItemClaimStatus.ACKNOWLEDGED;
      await this.claims.save(claim);
    }
    return { success: true };
  }

  async cancelClaim(userId: string, foundItemId: string): Promise<void> {
    if (!this.transactionScoped) return this.withItemLock(foundItemId, (scoped) => scoped.cancelClaim(userId, foundItemId));
    const itemId = foundItemId.trim();
    const claim = await this.claims.findOne({ where: { foundItemId: itemId, claimerId: userId } });
    if (!claim) {
      throw new NotFoundException('Found item claim not found');
    }

    if (claim.status === FoundItemClaimStatus.CANCELLED) return;
    if (!ACTIVE_CLAIM_STATUSES.includes(claim.status)) {
      throw new BadRequestException('Completed pickup requests cannot be cancelled');
    }
    claim.status = FoundItemClaimStatus.CANCELLED;
    await this.claims.save(claim);

    const remainingClaims = await this.claims.find({ where: { foundItemId: itemId } });
    if (!remainingClaims.some((current) => ACTIVE_CLAIM_STATUSES.includes(current.status))) {
      // A cancellation must never reopen an expired, reported or completed spot.
      await this.foundItems.update(
        { id: itemId, status: FoundItemStatus.CLAIMED },
        { status: FoundItemStatus.AVAILABLE },
      );
    }
  }

  async report(userId: string, foundItemId: string, dto: ReportFoundItemDto): Promise<{ success: boolean }> {
    if (!this.transactionScoped) return this.withItemLock(foundItemId, (scoped) => scoped.report(userId, foundItemId, dto));
    const reporter = await this.ensureActiveUser(userId);
    const item = await this.foundItems.findOne({ where: { id: foundItemId.trim() } });
    if (!item) {
      throw new NotFoundException('Found item not found');
    }

    if (!(FOUND_ITEM_REPORT_REASONS as readonly string[]).includes(dto.reason?.trim())) throw new BadRequestException('Choose a report reason');
    if (dto.reason === 'not_there') {
      const claim = await this.claims.findOne({ where: { foundItemId: item.id, claimerId: userId } });
      if (!claim || !ACTIVE_CLAIM_STATUSES.includes(claim.status)) {
        throw new ForbiddenException('Only an active claimant can report not there on arrival');
      }
    }
    const report = this.reports.create({
      foundItemId: item.id,
      foundItem: item,
      reporterId: reporter.id,
      reporter,
      reason: dto.reason.trim(),
      details: dto.details?.trim() || null,
    });
    await this.reports.save(report);
    if (dto.reason === 'already_gone' || dto.reason === 'not_there') {
      const claim = await this.claims.findOne({ where: { foundItemId: item.id, claimerId: userId } });
      if (claim?.status === FoundItemClaimStatus.ACKNOWLEDGED || (dto.latitude !== undefined && dto.longitude !== undefined)) {
        await this.observe(userId, item.id, { kind: 'gone', latitude: dto.latitude, longitude: dto.longitude });
      }
    } else if (item.status === FoundItemStatus.AVAILABLE || item.status === FoundItemStatus.CLAIMED) {
      await this.closeWithoutPickup(item, FoundItemStatus.REPORTED, new Date());
    }
    // A report is an unverified signal. It must not announce fly-tipping,
    // a successful pickup or environmental impact.

    return { success: true };
  }

  private async withItemLock<T>(
    id: string,
    operation: (service: FoundItemsService) => Promise<T>,
    onMissing?: () => T,
  ): Promise<T> {
    const effects: (() => Promise<void>)[] = [];
    const result = await this.foundItems.manager.transaction(async (manager) => {
      const items = manager.getRepository(FoundItem);
      // Every mutation takes this lock first, including claim creation and cancellation.
      // No external I/O is performed while the parent item is locked.
      const item = await items.findOne({ where: { id: id.trim() }, lock: { mode: 'pessimistic_write' } });
      if (!item) {
        if (onMissing) return onMissing();
        throw new NotFoundException('Found item not found');
      }
      const scoped = new FoundItemsService(items, manager.getRepository(FoundItemClaim),
        manager.getRepository(FoundItemReport), manager.getRepository(User), this.geocoding,
        this.notifications, this.notificationsGateway, this.gamification, manager.getRepository(FoundItemObservation));
      scoped.transactionScoped = true;
      scoped.afterCommit = effects;
      Object.assign(scoped.lifecyclePolicy, this.lifecyclePolicy);
      return operation(scoped);
    });
    for (const effect of effects) {
      try { await effect(); } catch { this.logger.warn('Optional found-item post-commit effect failed'); }
    }
    return result;
  }

  async reconfirm(userId: string, id: string): Promise<{ item: ReturnType<FoundItemsService['mapFoundItem']> }> {
    if (!this.transactionScoped) return this.withItemLock(id, (scoped) => scoped.reconfirm(userId, id));
    await this.ensureActiveUser(userId);
    const item = await this.foundItems.findOne({ where: { id: id.trim() }, relations: { poster: true } });
    if (!item) throw new NotFoundException('Found item not found');
    if (item.posterId !== userId) throw new ForbiddenException('Only the poster can reconfirm or dispute this spot');
    if ([FoundItemStatus.PICKED_UP, FoundItemStatus.REPORTED].includes(item.status)) {
      throw new BadRequestException('This closed spot cannot be reconfirmed');
    }
    const previous = await this.observations.find({ where: { foundItemId: item.id } });
    item.lastSeenAt = new Date(Math.max(Date.now(), ...previous.map((row) => row.observedAt.getTime() + 1), (item.lastSeenAt?.getTime() ?? 0) + 1));
    item.expiresAt = new Date(item.lastSeenAt.getTime() + this.lifecyclePolicy.expiryHours * 3600000);
    item.expiryNudgedAt = null;
    item.closedAt = null;
    if (item.status === FoundItemStatus.GONE || item.status === FoundItemStatus.EXPIRED) item.status = FoundItemStatus.AVAILABLE;
    await this.foundItems.save(item);
    const counts = await this.loadClaimCounts([item.id]);
    return { item: this.mapFoundItem(item, counts.get(item.id) ?? 0, null, userId) };
  }

  async observe(userId: string, id: string, dto: ObserveFoundItemDto): Promise<{ item: ReturnType<FoundItemsService['mapFoundItem']> }> {
    if (!this.transactionScoped) return this.withItemLock(id, (scoped) => scoped.observe(userId, id, dto));
    await this.ensureActiveUser(userId);
    const item = await this.foundItems.findOne({ where: { id: id.trim() }, relations: { poster: true } });
    if (!item) throw new NotFoundException('Found item not found');
    if (!['still_there', 'gone'].includes(dto.kind)) throw new BadRequestException('Choose a supported observation');
    if (item.posterId === userId && dto.kind === 'still_there') return this.reconfirm(userId, id);
    if (item.status === FoundItemStatus.GONE && dto.kind === 'gone') {
      const previous = await this.observations.find({ where: { foundItemId: item.id, observerId: userId } });
      if (item.posterId === userId || previous.some((row) => row.observerId === userId && row.kind === 'gone')) {
        const counts = await this.loadClaimCounts([item.id]);
        return { item: this.mapFoundItem(item, counts.get(item.id) ?? 0, null, userId) };
      }
    }
    if (![FoundItemStatus.AVAILABLE, FoundItemStatus.CLAIMED].includes(item.status)) {
      throw new BadRequestException('This spot is closed');
    }
    const claim = await this.claims.findOne({ where: { foundItemId: item.id, claimerId: userId } });
    const acknowledged = claim?.status === FoundItemClaimStatus.ACKNOWLEDGED;
    if (item.posterId !== userId && !acknowledged) {
      const origin = validLocationPoint(dto.latitude, dto.longitude);
      const point = publicLocationPoint(item.latitude, item.longitude);
      const distance = this.computeApproximateDistance(origin, point?.latitude ?? null, point?.longitude ?? null);
      if (!origin || distance === null || distance > this.lifecyclePolicy.nearbyKm) {
        throw new ForbiddenException('A self-attested location within the nearby area is required');
      }
    }
    const observedAt = new Date(Math.max(Date.now(), (item.lastSeenAt?.getTime() ?? 0) + 1));
    // Upsert under the same parent lock: an account can never supply two votes.
    await this.observations.upsert({ foundItemId: item.id, observerId: userId, kind: dto.kind, observedAt }, ['foundItemId', 'observerId']);
    if (dto.kind === 'still_there') {
      item.lastSeenAt = observedAt;
      item.expiresAt = new Date(observedAt.getTime() + this.lifecyclePolicy.expiryHours * 3600000);
      item.expiryNudgedAt = null;
      await this.foundItems.save(item);
    } else {
      const observations = await this.observations.find({ where: { foundItemId: item.id, kind: 'gone' } });
      const votes = new Set(observations.filter((row) => row.observedAt > (item.lastSeenAt ?? item.postedAt)).map((row) => row.observerId));
      if (item.posterId === userId || acknowledged || votes.size >= 2) await this.closeWithoutPickup(item, FoundItemStatus.GONE, observedAt);
    }
    const counts = await this.loadClaimCounts([item.id]);
    return { item: this.mapFoundItem(item, counts.get(item.id) ?? 0, null, userId) };
  }

  private async closeWithoutPickup(item: FoundItem, status: FoundItemStatus.GONE | FoundItemStatus.EXPIRED | FoundItemStatus.REPORTED, now: Date) {
    const claims = await this.claims.find({ where: { foundItemId: item.id } });
    for (const claim of claims.filter((row) => ACTIVE_CLAIM_STATUSES.includes(row.status))) {
      claim.status = FoundItemClaimStatus.CANCELLED;
      await this.claims.save(claim);
    }
    item.status = status;
    item.closedAt = now;
    await this.foundItems.save(item);
  }

  // Deliberately callable only: no scheduler, startup hook or automatic activation.
  async processLifecycle(now = new Date(), limit = 100): Promise<{ nudged: number; expired: number }> {
    const result = { nudged: 0, expired: 0 };
    const active = In([FoundItemStatus.AVAILABLE, FoundItemStatus.CLAIMED]);
    const nudgeBefore = new Date(now.getTime() - this.lifecyclePolicy.nudgeHours * 3600000);
    const candidates = await this.foundItems.find({ where: [
      { status: active, expiresAt: LessThanOrEqual(now), lastSeenAt: Not(IsNull()) },
      { status: active, expiresAt: MoreThan(now), expiryNudgedAt: IsNull(), lastSeenAt: LessThanOrEqual(nudgeBefore) },
    ], order: { id: 'ASC' }, take: Math.min(Math.max(limit, 1), 100) });
    for (const candidate of candidates) {
      const outcome = await this.withItemLock<keyof typeof result | null>(candidate.id, async (scoped) => {
        const item = await scoped.foundItems.findOne({ where: { id: candidate.id } });
        if (!item || ![FoundItemStatus.AVAILABLE, FoundItemStatus.CLAIMED].includes(item.status) || !item.lastSeenAt || !item.expiresAt) return null;
        if (item.expiresAt <= now) {
          await scoped.closeWithoutPickup(item, FoundItemStatus.EXPIRED, now);
          return 'expired';
        }
        if (!item.expiryNudgedAt && item.lastSeenAt <= nudgeBefore) {
          item.expiryNudgedAt = now;
          await scoped.foundItems.save(item);
          scoped.afterCommit.push(async () => { await scoped.notifications.createAndEmit(item.posterId, 'general', 'Is your spot still there?',
            'Reconfirm your spot if it is still available. Otherwise it will expire at its scheduled expiry.', { foundItemId: item.id }); });
          return 'nudged';
        }
        return null;
      }, () => null);
      if (outcome) result[outcome] += 1;
    }
    return result;
  }

  private async ensureActiveUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Inactive users cannot perform this action');
    }
    return user;
  }

  private resolvePostcode(dto: CreateFoundItemDto, user: User): string {
    const postcode =
      (typeof dto.location.postcode === 'string' && dto.location.postcode.trim()
        ? normalizePostcode(dto.location.postcode)
        : null) ||
      (typeof user.postcode === 'string' && user.postcode.trim()
        ? normalizePostcode(user.postcode)
        : null);
    if (!postcode) {
      throw new BadRequestException('A postcode is required to post a found item');
    }
    return postcode;
  }

  private async resolveLocation(dto: CreateFoundItemDto, user: User): Promise<ResolvedFoundItemLocation> {
    const address = dto.location.address?.trim() || null;
    const latitude =
      typeof dto.location.latitude === 'number' && Number.isFinite(dto.location.latitude)
        ? dto.location.latitude
        : null;
    const longitude =
      typeof dto.location.longitude === 'number' && Number.isFinite(dto.location.longitude)
        ? dto.location.longitude
        : null;

    if (latitude !== null && longitude !== null) {
      try {
        const reverse = await this.geocoding.reverseGeocode(latitude, longitude);
        return {
          postcode: reverse.postcode ?? this.resolvePostcode(dto, user),
          latitude,
          longitude,
          address: address ?? reverse.addressLine ?? null,
          neighborhood: reverse.neighborhood,
        };
      } catch (error) {
        this.logger.debug(safeFailure('found-item.reverse-geocode', error));
        return {
          postcode: this.resolvePostcode(dto, user),
          latitude,
          longitude,
          address,
          neighborhood: null,
        };
      }
    }

    const postcode = this.resolvePostcode(dto, user);
    const coordinates = await this.resolveCoordinates(dto, postcode);
    return {
      postcode,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      address,
      neighborhood: null,
    };
  }

  private async resolveCoordinates(dto: CreateFoundItemDto, postcode: string): Promise<{ latitude: number | null; longitude: number | null }> {
    const latitude = typeof dto.location.latitude === 'number' && Number.isFinite(dto.location.latitude)
      ? dto.location.latitude
      : null;
    const longitude = typeof dto.location.longitude === 'number' && Number.isFinite(dto.location.longitude)
      ? dto.location.longitude
      : null;

    if (latitude !== null && longitude !== null) {
      return { latitude, longitude };
    }

    const addressHint = dto.location.address?.trim();
    const query = [addressHint, postcode].filter(Boolean).join(', ');
    if (query) {
      try {
        const result = await this.geocoding.forwardGeocode(query);
        return { latitude: result.latitude, longitude: result.longitude };
      } catch (error) {
        this.logger.debug(safeFailure('found-item.forward-geocode', error));
      }
    }

    return { latitude, longitude };
  }

  private resolveImpact(
    category: string,
    title: string,
    weightKg?: number | null,
    carbonCatalogSelection?: CreateFoundItemDto['carbonCatalogSelection'],
  ): {
    weightKg: number;
    estimatedCo2eKg: number;
    impactPoints: number;
  } {
    const exactCatalogEntry = carbonCatalogSelection
      ? findFoundItemCarbonCatalogEntryBySelection({
          sourceCategory: carbonCatalogSelection.sourceCategory,
          subcategory: carbonCatalogSelection.subcategory,
          item: carbonCatalogSelection.item,
        })
      : null;

    const catalogEntry = exactCatalogEntry ?? findFoundItemCarbonCatalogEntry(category, title, weightKg);
    if (catalogEntry) {
      return this.resolveImpactFromCatalogEntry(catalogEntry, weightKg);
    }

    const profile = FOUND_ITEM_FALLBACK_IMPACT_FACTORS[category] ?? FOUND_ITEM_FALLBACK_IMPACT_FACTORS.other;
    const safeWeightKg = this.resolveWeightKg(weightKg, profile.defaultWeightKg);
    const estimatedCo2eKg = Math.max(12, Math.round(safeWeightKg * profile.impactFactor));

    return {
      weightKg: safeWeightKg,
      estimatedCo2eKg,
      impactPoints: estimatedCo2eKg,
    };
  }

  private resolveImpactFromCatalogEntry(
    catalogEntry: FoundItemCarbonCatalogEntry,
    weightKg?: number | null,
  ): {
    weightKg: number;
    estimatedCo2eKg: number;
    impactPoints: number;
  } {
    const resolvedWeightKg = this.resolveWeightKg(weightKg, catalogEntry.typicalWeightKg);

    return {
      weightKg: resolvedWeightKg,
      estimatedCo2eKg: this.scaleCatalogMetric(
        catalogEntry.netCo2eSavedKg,
        catalogEntry.typicalWeightKg,
        resolvedWeightKg,
      ),
      impactPoints: this.scaleCatalogMetric(
        catalogEntry.carbonPointsAwarded,
        catalogEntry.typicalWeightKg,
        resolvedWeightKg,
      ),
    };
  }

  private resolveWeightKg(weightKg: number | null | undefined, fallbackWeightKg: number): number {
    const resolvedWeightKg =
      typeof weightKg === 'number' && Number.isFinite(weightKg) && weightKg > 0
        ? weightKg
        : fallbackWeightKg;

    return Math.round(resolvedWeightKg * 10) / 10;
  }

  private scaleCatalogMetric(metric: number, typicalWeightKg: number, resolvedWeightKg: number): number {
    if (!(typicalWeightKg > 0)) {
      return Math.max(0, Math.round(metric));
    }

    const scaledMetric = (metric / typicalWeightKg) * resolvedWeightKg;
    return Math.max(0, Math.round(scaledMetric));
  }

  private mapCatalogEntry(entry: FoundItemCarbonCatalogEntry) {
    return {
      sourceCategory: entry.category,
      subcategory: entry.subcategory,
      item: entry.item,
      typicalWeightKg: entry.typicalWeightKg,
      estimatedCo2eKg: Math.max(0, Math.round(entry.netCo2eSavedKg)),
      impactPoints: Math.max(0, Math.round(entry.carbonPointsAwarded)),
    };
  }

  private normalizeImages(images?: CreateFoundItemImageDto[]): FoundItemImage[] {
    if (!images || !Array.isArray(images)) {
      return [];
    }

    const normalized: FoundItemImage[] = [];
    const seen = new Set<string>();
    for (const image of images) {
      const url = image.url?.trim();
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      normalized.push({
        url,
        thumbnailUrl: image.thumbnailUrl?.trim() || null,
        altText: image.altText?.trim() || null,
      });
      if (normalized.length >= 5) {
        break;
      }
    }
    return normalized;
  }

  private async resolveOrigin(query: SearchFoundItemsDto): Promise<{ latitude: number; longitude: number } | null> {
    if (query.lat !== undefined || query.lng !== undefined) {
      const point = validLocationPoint(query.lat, query.lng);
      if (!point) throw new BadRequestException('Enter valid search coordinates');
      return point;
    }
    if (!query.postcode) {
      return null;
    }

    try {
      const resolved = await this.geocoding.forwardGeocode(query.postcode);
      const point = validLocationPoint(resolved.latitude, resolved.longitude);
      if (!point) throw new Error('Invalid search origin');
      return point;
    } catch {
      this.logger.debug('Unable to resolve the supplied found-items search origin');
      throw new BadRequestException('Unable to resolve search location. Please try again.');
    }
  }

  private async loadClaimCounts(itemIds: string[]): Promise<Map<string, number>> {
    if (itemIds.length === 0) {
      return new Map();
    }

    const rows = await this.claims
      .createQueryBuilder('claim')
      .select('claim.found_item_id', 'itemId')
      .addSelect('COUNT(*)', 'claimCount')
      .where('claim.found_item_id IN (:...itemIds)', { itemIds })
      .andWhere('claim.status <> :status', { status: FoundItemClaimStatus.CANCELLED })
      .groupBy('claim.found_item_id')
      .getRawMany<{ itemId: string; claimCount: string }>();

    return new Map(rows.map((row) => [row.itemId, Number(row.claimCount)]));
  }

  private sortItems<T extends { postedAt: string; viewCount: number; location: { approximateDistance: number | null } }>(
    items: T[],
    sortBy: FoundItemSortBy,
  ): T[] {
    if (sortBy === FoundItemSortBy.POPULAR) {
      return [...items].sort((left, right) => right.viewCount - left.viewCount);
    }
    if (sortBy === FoundItemSortBy.NEAREST) {
      return [...items].sort((left, right) => {
        const leftDistance = left.location.approximateDistance ?? Number.MAX_SAFE_INTEGER;
        const rightDistance = right.location.approximateDistance ?? Number.MAX_SAFE_INTEGER;
        return leftDistance - rightDistance;
      });
    }
    return [...items].sort(
      (left, right) => new Date(right.postedAt).getTime() - new Date(left.postedAt).getTime(),
    );
  }

  private mapFoundItem(
    item: FoundItem,
    claimCount: number,
    origin: { latitude: number; longitude: number } | null,
    viewerId?: string,
  ) {
    const location = projectFoundItemLocation(item, viewerId !== undefined && viewerId === item.posterId);
    // Public list membership and ordering always use the public point, including
    // when the current viewer happens to own an entry in that public feed.
    const publicPoint = publicLocationPoint(item.latitude, item.longitude);
    const approximateDistance = this.computeApproximateDistance(origin, publicPoint?.latitude ?? null, publicPoint?.longitude ?? null);
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      category: item.category,
      status: item.status,
      images: (item.images || []).map((image) => ({
        url: image.url,
        thumbnailUrl: image.thumbnailUrl || image.url,
        altText: image.altText ?? null,
      })),
      location: {
        ...location,
        approximateDistance,
      },
      condition: item.condition ?? null,
      weightKg: item.weightKg ?? null,
      estimatedCo2eKg: item.estimatedCo2eKg ?? 0,
      impactPoints: item.impactPoints ?? 0,
      isFlyTipped: item.isFlyTipped === true,
      poster: {
        id: item.poster.id,
        name: PUBLIC_ACTOR_LABEL,
        avatarUrl: item.poster.profileImageUrl ?? null,
      },
      postedAt: item.postedAt.toISOString(),
      expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
      lastSeenAt: item.lastSeenAt?.toISOString() ?? null,
      closedAt: item.closedAt?.toISOString() ?? null,
      claimCount,
      viewCount: item.viewCount,
    };
  }

  private computeApproximateDistance(
    origin: { latitude: number; longitude: number } | null,
    latitude: number | null,
    longitude: number | null,
  ): number | null {
    if (!origin || latitude === null || longitude === null) {
      return null;
    }

    const toRadians = (value: number) => (value * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const deltaLat = toRadians(latitude - origin.latitude);
    const deltaLng = toRadians(longitude - origin.longitude);
    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(toRadians(origin.latitude)) * Math.cos(toRadians(latitude)) *
      Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const bounded = Math.min(1, Math.max(0, a));
    const c = 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
    return Math.round(earthRadiusKm * c * 10) / 10;
  }
}
