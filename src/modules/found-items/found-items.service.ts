import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { GamificationService } from '../gamification/gamification.service';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import { NotificationsService } from '../notifications/notifications.service';
import { User, UserStatus } from '../users/user.entity';
import { CreateFoundItemClaimDto } from './dto/create-found-item-claim.dto';
import { CreateFoundItemDto, CreateFoundItemImageDto } from './dto/create-found-item.dto';
import { MyFoundItemsQueryDto } from './dto/my-found-items-query.dto';
import { ReportFoundItemDto } from './dto/report-found-item.dto';
import { FoundItemSortBy, SearchFoundItemsDto } from './dto/search-found-items.dto';
import { UpdateFoundItemStatusDto } from './dto/update-found-item-status.dto';
import { FoundItem, FoundItemImage, FoundItemStatus } from './found-item.entity';
import { FoundItemClaim, FoundItemClaimStatus } from './found-item-claim.entity';
import { FoundItemReport } from './found-item-report.entity';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_PAGE = 1;
const DEFAULT_MAX_DISTANCE_KM = 5;
const ACTIVE_CLAIM_STATUSES: readonly FoundItemClaimStatus[] = [FoundItemClaimStatus.PENDING, FoundItemClaimStatus.ACKNOWLEDGED];

@Injectable()
export class FoundItemsService {
  private readonly logger = new Logger(FoundItemsService.name);

  constructor(
    @InjectRepository(FoundItem) private readonly foundItems: Repository<FoundItem>,
    @InjectRepository(FoundItemClaim) private readonly claims: Repository<FoundItemClaim>,
    @InjectRepository(FoundItemReport) private readonly reports: Repository<FoundItemReport>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly geocoding: ItemGeocodingService,
    private readonly notifications: NotificationsService,
    private readonly gamification: GamificationService,
  ) {}

  async list(userId: string, query: SearchFoundItemsDto) {
    const page = Math.max(query.page ?? DEFAULT_PAGE, DEFAULT_PAGE);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const status = query.status ?? FoundItemStatus.AVAILABLE;

    const qb = this.foundItems
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.poster', 'poster')
      .where('item.status = :status', { status });

    if (query.category) {
      qb.andWhere('LOWER(item.category) = LOWER(:category)', { category: query.category });
    }
    if (query.postcode) {
      qb.andWhere('UPPER(item.postcode) LIKE :postcode', { postcode: `%${query.postcode}%` });
    }

    const items = await qb.getMany();
    const claimCounts = await this.loadClaimCounts(items.map((item) => item.id));
    const origin = await this.resolveOrigin(query);
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

    return {
      item: this.mapFoundItem(item, claimCounts.get(item.id) ?? 0, null),
      claims: claims.map((claim) => ({
        id: claim.id,
        foundItemId: claim.foundItemId,
        claimerId: claim.claimerId,
        claimerName: this.getUserDisplayName(claim.claimer),
        message: claim.message ?? null,
        status: claim.status,
        createdAt: claim.createdAt.toISOString(),
      })),
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
      items: pagedItems.map((item) => this.mapFoundItem(item, claimCounts.get(item.id) ?? 0, null)),
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
    const postcode = this.resolvePostcode(dto, poster);
    const coordinates = await this.resolveCoordinates(dto, postcode);
    const item = this.foundItems.create({
      posterId: poster.id,
      poster,
      title: dto.title.trim(),
      description: dto.description.trim(),
      category: dto.category,
      condition: dto.condition?.trim() || null,
      status: FoundItemStatus.AVAILABLE,
      address: dto.location.address?.trim() || null,
      neighborhood: null,
      postcode,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      images: this.normalizeImages(dto.images),
      expiresAt: null,
    });

    const saved = await this.foundItems.save(item);
    try {
      await this.gamification.recordFoundItemPosted(poster.id, saved.id, saved.postedAt);
    } catch (error) {
      this.logger.warn(`Unable to record found-item post activity for ${saved.id}: ${String(error)}`);
    }

    return { item: this.mapFoundItem(saved, 0, null) };
  }

  async updateStatus(userId: string, foundItemId: string, dto: UpdateFoundItemStatusDto) {
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
        await this.gamification.recordFoundItemPickedUp(userId, item.id, new Date());
      } catch (error) {
        this.logger.warn(`Unable to record found-item pickup activity for ${item.id}: ${String(error)}`);
      }
    }

    if (dto.status === FoundItemStatus.AVAILABLE || dto.status === FoundItemStatus.EXPIRED) {
      for (const claim of activeClaims.filter((currentClaim) => ACTIVE_CLAIM_STATUSES.includes(currentClaim.status))) {
        claim.status = FoundItemClaimStatus.CANCELLED;
        await this.claims.save(claim);
      }
    }

    item.status = dto.status;
    const saved = await this.foundItems.save(item);
    const claimCount = await this.loadClaimCounts([saved.id]);

    return { item: this.mapFoundItem(saved, claimCount.get(saved.id) ?? 0, null) };
  }

  async remove(userId: string, foundItemId: string): Promise<void> {
    const item = await this.foundItems.findOne({ where: { id: foundItemId.trim() } });
    if (!item) {
      throw new NotFoundException('Found item not found');
    }
    if (item.posterId !== userId) {
      throw new ForbiddenException('Only the poster can delete this found item');
    }

    await this.foundItems.delete(item.id);
  }

  async claim(userId: string, foundItemId: string, dto: CreateFoundItemClaimDto) {
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
    if (item.status !== FoundItemStatus.AVAILABLE) {
      throw new BadRequestException('This found item is no longer available');
    }

    const existingClaim = await this.claims.findOne({ where: { foundItemId: item.id, claimerId: userId } });
    if (existingClaim && existingClaim.status !== FoundItemClaimStatus.CANCELLED) {
      throw new BadRequestException('You have already claimed this item');
    }

    const claim = this.claims.create({
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
      await this.gamification.recordFoundItemClaimed(userId, savedClaim.id, savedClaim.createdAt);
    } catch (error) {
      this.logger.warn(`Unable to record found-item claim activity for ${savedClaim.id}: ${String(error)}`);
    }

    try {
      await this.notifications.createAndEmit(
        item.posterId,
        'general',
        'Found item interest',
        `${this.getUserDisplayName(claimer)} wants to pick up “${item.title}”.`,
        { foundItemId: item.id, claimId: savedClaim.id },
      );
    } catch {}

    return {
      claim: {
        id: savedClaim.id,
        foundItemId: savedClaim.foundItemId,
        claimerId: savedClaim.claimerId,
        claimerName: this.getUserDisplayName(claimer),
        message: savedClaim.message ?? null,
        status: savedClaim.status,
        createdAt: savedClaim.createdAt.toISOString(),
      },
    };
  }

  async cancelClaim(userId: string, foundItemId: string): Promise<void> {
    const itemId = foundItemId.trim();
    const claim = await this.claims.findOne({ where: { foundItemId: itemId, claimerId: userId } });
    if (!claim) {
      throw new NotFoundException('Found item claim not found');
    }

    claim.status = FoundItemClaimStatus.CANCELLED;
    await this.claims.save(claim);

    const activeClaims = await this.claims.count({
      where: { foundItemId: itemId, status: FoundItemClaimStatus.PENDING },
    });
    if (activeClaims === 0) {
      await this.foundItems.update(itemId, { status: FoundItemStatus.AVAILABLE });
    }
  }

  async report(userId: string, foundItemId: string, dto: ReportFoundItemDto) {
    const reporter = await this.ensureActiveUser(userId);
    const item = await this.foundItems.findOne({ where: { id: foundItemId.trim() } });
    if (!item) {
      throw new NotFoundException('Found item not found');
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
    item.status = FoundItemStatus.REPORTED;
    await this.foundItems.save(item);

    return { success: true };
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
    const postcode = dto.location.postcode?.trim().toUpperCase() || user.postcode?.trim().toUpperCase();
    if (!postcode) {
      throw new BadRequestException('A postcode is required to post a found item');
    }
    return postcode;
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
        this.logger.debug(`Found-item geocoding fallback for query="${query}": ${String(error)}`);
      }
    }

    return { latitude, longitude };
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
    if (typeof query.lat === 'number' && typeof query.lng === 'number') {
      return { latitude: query.lat, longitude: query.lng };
    }
    if (!query.postcode) {
      return null;
    }

    try {
      return this.geocoding.forwardGeocode(query.postcode);
    } catch (error) {
      this.logger.debug(`Unable to geocode found-items origin ${query.postcode}: ${String(error)}`);
      return null;
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
  ) {
    const approximateDistance = this.computeApproximateDistance(origin, item.latitude ?? null, item.longitude ?? null);
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
        latitude: item.latitude ?? 0,
        longitude: item.longitude ?? 0,
        address: item.address ?? null,
        neighborhood: item.neighborhood ?? null,
        postcode: item.postcode,
        approximateDistance,
      },
      condition: item.condition ?? null,
      poster: {
        id: item.poster.id,
        name: this.getUserDisplayName(item.poster),
        avatarUrl: item.poster.profileImageUrl ?? null,
      },
      postedAt: item.postedAt.toISOString(),
      expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
      claimCount,
      viewCount: item.viewCount,
    };
  }

  private getUserDisplayName(user: User): string {
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    if (fullName) {
      return fullName;
    }
    return user.email.split('@')[0] || 'Community member';
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
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(earthRadiusKm * c * 10) / 10;
  }
}