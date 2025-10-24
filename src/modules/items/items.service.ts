import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Claim } from '../claims/claim.entity';
import { QrImageService } from '../qr/qr-image.service';
import { UserReview } from '../reviews/user-review.entity';
import { KycProfile, KycStatus } from '../users/kyc-profile.entity';
import { User, UserStatus } from '../users/user.entity';
import { Shop } from '../shops/shop.entity';

import { Co2EstimationService } from './co2-estimation.service';
import { CreateItemDto, CreateItemImageDto } from './dto/create-item.dto';
import { SearchItemsDto } from './dto/search-items.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { UserCollectedItemsQueryDto, UserItemsQueryDto } from './dto/user-items-query.dto';
import { ItemGeocodingService } from './item-geocoding.service';
import { ItemLocation } from './item-location.interface';
import { Item, ItemPickupOption, ItemStatus, SizeUnit } from './item.entity';

const DEFAULT_RADIUS_KM = 5;
const MIN_RADIUS_KM = 0.1;
const MAX_RADIUS_KM = 50;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_PAGE = 1;
const MAX_PAGE = 100;
const PUBLIC_ITEM_STATUSES: readonly ItemStatus[] = [
  ItemStatus.ACTIVE,
  // Once a claim is approved the item is still visible for tracking/logistics
  ItemStatus.CLAIMED,
  ItemStatus.PENDING_DROPOFF,
  ItemStatus.AWAITING_COLLECTION,
  ItemStatus.PENDING_RECYCLE,
  ItemStatus.PENDING_RECYCLE_PROCESSING,
];
const EDITABLE_ITEM_STATUSES: readonly ItemStatus[] = [
  ItemStatus.DRAFT,
  ItemStatus.ACTIVE,
  ItemStatus.PENDING_DROPOFF,
  ItemStatus.AWAITING_COLLECTION,
  ItemStatus.PENDING_RECYCLE,
  ItemStatus.PENDING_RECYCLE_PROCESSING,
];
const DELETABLE_ITEM_STATUSES: readonly ItemStatus[] = [
  ItemStatus.DRAFT,
  ItemStatus.ACTIVE,
  ItemStatus.PENDING_DROPOFF,
  ItemStatus.AWAITING_COLLECTION,
  ItemStatus.PENDING_RECYCLE,
  ItemStatus.PENDING_RECYCLE_PROCESSING,
];

const IMPACT_ITEM_STATUSES: readonly ItemStatus[] = [
  ItemStatus.COMPLETE,
  ItemStatus.RECYCLED,
];
const DEFAULT_MONTHLY_CO2_GOAL_KG = 50;

export interface DropoffLocationView {
  id: string;
  name: string;
  phone_number: string | null;
  address_line: string;
  postcode: string;
  operational_notes: string | null;
  latitude: number | null;
  longitude: number | null;
  opening_hours: { days?: string[]; open_time?: string; close_time?: string } | null;
  acceptable_categories: string[];
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

  constructor(
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(Claim) private readonly claims: Repository<Claim>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(KycProfile) private readonly kycs: Repository<KycProfile>,
    @InjectRepository(UserReview) private readonly reviews: Repository<UserReview>,
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    private readonly geocoding: ItemGeocodingService,
    private readonly qrImage: QrImageService,
    private readonly co2: Co2EstimationService,
  ) {}

  private readonly qrBaseUrl = (process.env.ITEM_QR_BASE_URL || 'https://cdn.trucycle.com/qrs').replace(/\/$/, '');
  private readonly monthlyCo2GoalKg = this.resolveMonthlyCo2Goal();

  private determineInitialStatus(option: ItemPickupOption): ItemStatus {
    switch (option) {
      case ItemPickupOption.DONATE:
        return ItemStatus.PENDING_DROPOFF;
      case ItemPickupOption.RECYCLE:
        return ItemStatus.PENDING_RECYCLE;
      case ItemPickupOption.EXCHANGE:
      default:
        return ItemStatus.ACTIVE;
    }
  }

  private sanitizeMetadata(input?: Record<string, any>): Record<string, string | number | boolean> | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const safe: Record<string, string | number | boolean> = {};
    const entries = Object.entries(input).slice(0, 20);
    for (const [rawKey, rawValue] of entries) {
      if (typeof rawKey !== 'string') continue;
      const key = rawKey.trim().slice(0, 60);
      if (!key) continue;
      if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim().slice(0, 240);
        if (trimmed) safe[key] = trimmed;
      } else if (typeof rawValue === 'number') {
        if (Number.isFinite(rawValue)) safe[key] = rawValue;
      } else if (typeof rawValue === 'boolean') {
        safe[key] = rawValue;
      }
    }
    return Object.keys(safe).length ? safe : null;
  }


  private resolveMonthlyCo2Goal(): number {
    const raw = process.env.MONTHLY_CO2_SAVINGS_GOAL_KG ?? process.env.MONTHLY_CO2_GOAL_KG;
    if (typeof raw !== 'string') {
      return DEFAULT_MONTHLY_CO2_GOAL_KG;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_MONTHLY_CO2_GOAL_KG;
    }
    return Math.min(parsed, 100000);
  }

  private coerceNumber(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private roundMetric(value: number, decimals = 1): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    const precision = Math.max(0, Math.min(4, Math.trunc(decimals)));
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }

  private buildQrCodeUrl(id: string): string {
    return `${this.qrBaseUrl}/item-${id}.png`;
  }

  private normalizeImagesForPersistence(
    images?: ReadonlyArray<CreateItemImageDto | { url?: string; altText?: string | null }>,
  ): { url: string; altText: string | null }[] {
    if (!Array.isArray(images)) {
      return [];
    }
    const normalized: { url: string; altText: string | null }[] = [];
    const seen = new Set<string>();
    for (const raw of images) {
      if (!raw) continue;
      const urlValue = typeof raw === 'string' ? raw : raw.url;
      if (typeof urlValue !== 'string') continue;
      const trimmedUrl = urlValue.trim();
      if (!trimmedUrl || trimmedUrl.length > 2048) continue;
      const lower = trimmedUrl.toLowerCase();
      if (!lower.startsWith('http://') && !lower.startsWith('https://')) continue;
      if (seen.has(trimmedUrl)) continue;
      seen.add(trimmedUrl);
      let altText: string | null = null;
      if (typeof (raw as any).altText === 'string') {
        const trimmedAlt = (raw as any).altText.trim().slice(0, 120);
        altText = trimmedAlt.length ? trimmedAlt : null;
      }
      normalized.push({ url: trimmedUrl, altText });
      if (normalized.length >= 10) break;
    }
    return normalized;
  }

  private normalizeImagesForOutput(raw: any): { url: string; alt_text: string | null }[] {
    const output: { url: string; alt_text: string | null }[] = [];
    if (!raw) {
      return output;
    }
    let candidate: any[] = [];
    if (Array.isArray(raw)) {
      candidate = raw;
    } else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          candidate = parsed;
        }
      } catch {
        return output;
      }
    }
    const seen = new Set<string>();
    for (const entry of candidate) {
      if (!entry) continue;
      let url: string | null = null;
      let alt: string | null = null;
      if (typeof entry === 'string') {
        url = entry;
      } else if (typeof entry === 'object') {
        if (typeof entry.url === 'string') {
          url = entry.url;
        }
        if (typeof entry.altText === 'string') {
          alt = entry.altText;
        } else if (typeof entry.alt_text === 'string') {
          alt = entry.alt_text;
        }
      }
      if (!url) continue;
      const trimmed = url.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      const altNormalized = alt ? alt.trim().slice(0, 120) : null;
      output.push({ url: trimmed, alt_text: altNormalized && altNormalized.length ? altNormalized : null });
      if (output.length >= 5) break;
    }
    return output;
  }

  private formatDate(input: any): string | null {
    if (!input) {
      return null;
    }
    if (input instanceof Date && !Number.isNaN(input.getTime())) {
      return input.toISOString();
    }
    const parsed = new Date(input as any);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  private sanitizeShopId(input: unknown): string {
    return typeof input === 'string' ? input.trim() : '';
  }

  private formatShopForOutput(shop: Shop): DropoffLocationView {
    const phoneNumber =
      typeof shop.phoneNumber === 'string' && shop.phoneNumber.trim() ? shop.phoneNumber.trim() : null;
    const operationalNotes =
      typeof shop.operationalNotes === 'string' && shop.operationalNotes.trim() ? shop.operationalNotes.trim() : null;
    const latitude = Number.isFinite(shop.latitude) ? Number(shop.latitude) : null;
    const longitude = Number.isFinite(shop.longitude) ? Number(shop.longitude) : null;
    const openingHours = shop.openingHours ? { ...shop.openingHours } : null;
    const acceptableCategories = Array.isArray(shop.acceptableCategories) ? [...shop.acceptableCategories] : [];

    return {
      id: shop.id,
      name: shop.name,
      phone_number: phoneNumber,
      address_line: shop.addressLine,
      postcode: shop.postcode,
      operational_notes: operationalNotes,
      latitude,
      longitude,
      opening_hours: openingHours,
      acceptable_categories: acceptableCategories,
      active: !!shop.active,
      created_at: this.formatDate(shop.createdAt),
      updated_at: this.formatDate(shop.updatedAt),
    };
  }

  private async loadDropoffLocations(
    ids: ReadonlyArray<string | null | undefined>,
  ): Promise<Map<string, DropoffLocationView>> {
    const sanitized = Array.from(
      new Set(
        ids
          .map((id) => this.sanitizeShopId(id))
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );

    if (sanitized.length === 0) {
      return new Map();
    }

    const shops = await this.shops.find({ where: { id: In(sanitized), active: true } });
    const entries = shops.map((shop) => [shop.id, this.formatShopForOutput(shop)] as const);
    return new Map(entries);
  }

  private async loadDropoffLocation(shopId?: string | null): Promise<DropoffLocationView | null> {
    const sanitized = this.sanitizeShopId(shopId);
    if (!sanitized) {
      return null;
    }
    const shop = await this.shops.findOne({ where: { id: sanitized, active: true } });
    if (!shop) {
      return null;
    }
    return this.formatShopForOutput(shop);
  }

  private async fetchScanEvents(itemId: string) {
    try {
      const rows: any[] = await this.items.query(
        'SELECT scan_type, shop_id, scanned_at FROM item_scan_event WHERE item_id = $1 ORDER BY scanned_at DESC LIMIT 50',
        [itemId],
      );
      const events: { scan_type: string; shop_id: string | null; scanned_at: string | null }[] = [];
      for (const row of rows || []) {
        if (!row) continue;
        const scanType =
          typeof row.scan_type === 'string'
            ? row.scan_type.trim().toUpperCase().slice(0, 60)
            : null;
        if (!scanType) continue;
        const shopId =
          typeof row.shop_id === 'string' ? row.shop_id.trim().slice(0, 64) || null : null;
        let scannedAt: string | null = null;
        const rawDate = row.scanned_at instanceof Date ? row.scanned_at : row.scanned_at ? new Date(row.scanned_at) : null;
        if (rawDate && !Number.isNaN(rawDate.getTime())) {
          scannedAt = rawDate.toISOString();
        }
        events.push({ scan_type: scanType, shop_id: shopId, scanned_at: scannedAt });
        if (events.length >= 25) {
          break;
        }
      }
      return events;
    } catch (err) {
      this.logger.debug(`Scan events unavailable for item ${itemId}: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }


  async getUserListedItems(userId: string, dto: UserItemsQueryDto) {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId) {
      throw new BadRequestException('User id is required');
    }

    const limitRaw = dto?.limit;
    let limit = typeof limitRaw === 'number' && Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT;
    limit = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);

    const pageRaw = dto?.page;
    let page = typeof pageRaw === 'number' && Number.isFinite(pageRaw) ? pageRaw : DEFAULT_PAGE;
    page = Math.min(Math.max(Math.trunc(page), 1), MAX_PAGE);
    const offset = (page - 1) * limit;

    const qb = this.items
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.donor', 'donor')
      .where('item.donor_id = :userId', { userId: normalizedUserId })
      .orderBy('item.createdAt', 'DESC')
      .skip(offset)
      .take(limit);

    if (dto?.status) {
      qb.andWhere('item.status = :status', { status: dto.status });
    }

    const [rows, total] = await qb.getManyAndCount();

    const itemIds = rows.map((item) => item.id);
    const claimRows =
      itemIds.length > 0
        ? await this.claims.find({ where: { item: { id: In(itemIds) } } })
        : [];
    const claimMap = new Map<string, Claim>(claimRows.map((claim) => [claim.item.id, claim]));

    const dropoffMap = await this.loadDropoffLocations(rows.map((item) => item.dropoffLocationId));

    const items = rows.map((item) => {
      const claim = claimMap.get(item.id);
      const metadata = this.sanitizeMetadata(item.metadata ?? undefined);
      const collector = claim?.collector;
      const collectorDetails = collector
        ? {
            id: collector.id,
            name: this.displayName(collector),
            profile_image: collector.profileImageUrl ?? null,
          }
        : null;

      const latitude =
        typeof item.latitude === 'number' && Number.isFinite(item.latitude) ? Number(item.latitude) : null;
      const longitude =
        typeof item.longitude === 'number' && Number.isFinite(item.longitude) ? Number(item.longitude) : null;

      return {
        id: item.id,
        title: typeof item.title === 'string' ? item.title.trim() : '',
        status: item.status,
        condition: item.condition,
        category: item.category,
        pickup_option: item.pickupOption,
        qr_code:
          typeof item.qrCodeUrl === 'string' && item.qrCodeUrl.trim()
            ? item.qrCodeUrl.trim()
            : this.buildQrCodeUrl(item.id),
        images: this.normalizeImagesForOutput(item.images),
        estimated_co2_saved_kg:
          typeof item.estimatedCo2SavedKg === 'number' && Number.isFinite(item.estimatedCo2SavedKg)
            ? Number(item.estimatedCo2SavedKg)
            : null,
        metadata,
        location: {
          address_line:
            typeof item.addressLine === 'string' && item.addressLine.trim()
              ? item.addressLine.trim()
              : null,
          postcode:
            typeof item.postcode === 'string' && item.postcode.trim()
              ? item.postcode.trim().toUpperCase()
              : null,
          latitude,
          longitude,
        },
        dropoff_location: dropoffMap.get(this.sanitizeShopId(item.dropoffLocationId)) ?? null,
        created_at: this.formatDate(item.createdAt),
        claim: claim
          ? {
              id: claim.id,
              status: claim.status,
              approved_at: this.formatDate(claim.approvedAt),
              completed_at: this.formatDate(claim.completedAt),
              collector: collectorDetails,
            }
          : null,
      };
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    };
  }

  async getUserCollectedItems(userId: string, dto: UserCollectedItemsQueryDto) {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId) {
      throw new BadRequestException('User id is required');
    }

    const limitRaw = dto?.limit;
    let limit = typeof limitRaw === 'number' && Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT;
    limit = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);

    const pageRaw = dto?.page;
    let page = typeof pageRaw === 'number' && Number.isFinite(pageRaw) ? pageRaw : DEFAULT_PAGE;
    page = Math.min(Math.max(Math.trunc(page), 1), MAX_PAGE);
    const offset = (page - 1) * limit;

    const qb = this.claims
      .createQueryBuilder('claim')
      .leftJoinAndSelect('claim.item', 'item')
      .leftJoinAndSelect('item.donor', 'donor')
      .where('claim.collector_id = :userId', { userId: normalizedUserId })
      .orderBy('claim.createdAt', 'DESC')
      .skip(offset)
      .take(limit);

    if (dto?.claim_status) {
      qb.andWhere('claim.status = :claimStatus', { claimStatus: dto.claim_status });
    }
    if (dto?.status) {
      qb.andWhere('item.status = :itemStatus', { itemStatus: dto.status });
    }

    const [claims, total] = await qb.getManyAndCount();

    const donorIds = Array.from(
      new Set(
        claims
          .map((claim) => claim.item?.donor?.id)
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      ),
    );

    const ownerPairs = await Promise.all(
      donorIds.map(async (donorId) => [donorId, await this.buildOwnerDetails(donorId)] as const),
    );
    const ownerMap = new Map(ownerPairs);

    const dropoffMap = await this.loadDropoffLocations(claims.map((claim) => claim.item?.dropoffLocationId));

    const items = claims.map((claim) => {
      const item = claim.item;
      const metadata = item ? this.sanitizeMetadata(item.metadata ?? undefined) : null;
      const images = item ? this.normalizeImagesForOutput(item.images) : [];
      const owner = item?.donor ? ownerMap.get(item.donor.id) ?? null : null;
      const latitude =
        item && typeof item.latitude === 'number' && Number.isFinite(item.latitude) ? Number(item.latitude) : null;
      const longitude =
        item && typeof item.longitude === 'number' && Number.isFinite(item.longitude)
          ? Number(item.longitude)
          : null;

      return {
        claim_id: claim.id,
        claim_status: claim.status,
        claim_created_at: this.formatDate(claim.createdAt),
        claim_approved_at: this.formatDate(claim.approvedAt),
        claim_completed_at: this.formatDate(claim.completedAt),
        item: item
          ? {
              id: item.id,
              title: typeof item.title === 'string' ? item.title.trim() : '',
              status: item.status,
              condition: item.condition,
              category: item.category,
              pickup_option: item.pickupOption,
              qr_code:
                typeof item.qrCodeUrl === 'string' && item.qrCodeUrl.trim()
                  ? item.qrCodeUrl.trim()
                  : this.buildQrCodeUrl(item.id),
              images,
              metadata,
              estimated_co2_saved_kg:
                typeof item.estimatedCo2SavedKg === 'number' && Number.isFinite(item.estimatedCo2SavedKg)
                  ? Number(item.estimatedCo2SavedKg)
                  : null,
              location: {
                address_line:
                  typeof item.addressLine === 'string' && item.addressLine.trim()
                    ? item.addressLine.trim()
                    : null,
                postcode:
                  typeof item.postcode === 'string' && item.postcode.trim()
                    ? item.postcode.trim().toUpperCase()
                    : null,
                latitude,
                longitude,
              },
              dropoff_location: dropoffMap.get(this.sanitizeShopId(item.dropoffLocationId)) ?? null,
              created_at: this.formatDate(item.createdAt),
              owner,
            }
          : null,
      };
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    };
  }


  async getUserImpactMetrics(userId: string) {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId) {
      throw new BadRequestException('User id is required');
    }

    const impactStatuses = Array.from(IMPACT_ITEM_STATUSES);

    const totalsRaw = await this.items
      .createQueryBuilder('item')
      .select('COALESCE(SUM(item.estimated_co2_saved_kg), 0)', 'total_co2')
      .addSelect("SUM(CASE WHEN item.pickup_option = :exchange THEN 1 ELSE 0 END)", 'exchange_count')
      .addSelect("SUM(CASE WHEN item.pickup_option = :donate THEN 1 ELSE 0 END)", 'donate_count')
      .where('item.donor_id = :userId', { userId: normalizedUserId })
      .andWhere('item.status IN (:...impactStatuses)', { impactStatuses })
      .setParameters({
        exchange: ItemPickupOption.EXCHANGE,
        donate: ItemPickupOption.DONATE,
      })
      .getRawOne<{ total_co2: string | number | null; exchange_count: string | number | null; donate_count: string | number | null }>();

    const totalCo2Raw = this.coerceNumber(totalsRaw?.total_co2);
    const itemsExchanged = Math.max(0, Math.trunc(this.coerceNumber(totalsRaw?.exchange_count)));
    const itemsDonated = Math.max(0, Math.trunc(this.coerceNumber(totalsRaw?.donate_count)));

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const startOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

    const monthlyRaw = await this.items
      .createQueryBuilder('item')
      .select('COALESCE(SUM(item.estimated_co2_saved_kg), 0)', 'monthly_co2')
      .leftJoin(Claim, 'claim', 'claim.item_id = item.id')
      .where('item.donor_id = :userId', { userId: normalizedUserId })
      .andWhere('item.status IN (:...impactStatuses)', { impactStatuses })
      .andWhere('COALESCE(claim.completed_at, item.updated_at) >= :startOfMonth', { startOfMonth })
      .andWhere('COALESCE(claim.completed_at, item.updated_at) < :startOfNextMonth', { startOfNextMonth })
      .getRawOne<{ monthly_co2: string | number | null }>();

    const monthlyCo2Raw = this.coerceNumber(monthlyRaw?.monthly_co2);

    const goalKg = this.monthlyCo2GoalKg;
    const totalCo2SavedKg = this.roundMetric(totalCo2Raw);
    const monthlyAchievedKg = this.roundMetric(monthlyCo2Raw);
    const remainingKg = goalKg > 0 ? Math.max(goalKg - monthlyCo2Raw, 0) : 0;
    const remainingKgRounded = this.roundMetric(remainingKg);
    const percentRaw = goalKg > 0 ? (monthlyCo2Raw / goalKg) * 100 : 0;
    const progressPercent = this.roundMetric(Math.max(0, Math.min(100, percentRaw)), 1);
    const targetKg = this.roundMetric(goalKg);

    return {
      total_co2_saved_kg: totalCo2SavedKg,
      items_exchanged: itemsExchanged,
      items_donated: itemsDonated,
      monthly_goal: {
        target_kg: targetKg,
        achieved_kg: monthlyAchievedKg,
        remaining_kg: remainingKgRounded,
        progress_percent: progressPercent,
      },
    };
  }
  async createItem(userId: string, dto: CreateItemDto) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('User must have an active account to list items');
    }

    if (dto.pickupOption === ItemPickupOption.DONATE && !dto.dropoffLocationId) {
      throw new BadRequestException('dropoff_location_id is required for donate pickups');
    }

    // Geocode strictly by postcode to avoid noisy address lines
    let location: ItemLocation;
    try {
      location = await this.geocoding.forwardGeocode(dto.postcode);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new ServiceUnavailableException('Failed to geocode address');
    }

    

    const status = this.determineInitialStatus(dto.pickupOption);
    const metadata = this.sanitizeMetadata(dto.metadata);
    const images = this.normalizeImagesForPersistence(dto.images);

    const entity = this.items.create({
      donor: user,
      title: dto.title,
      description: dto.description ?? null,
      condition: dto.condition,
      category: dto.category,
      pickupOption: dto.pickupOption,
      status,
      dropoffLocationId: dto.dropoffLocationId ?? null,
      deliveryPreferences: dto.deliveryPreferences ?? null,
      addressLine: dto.addressLine,
      postcode: dto.postcode,
      images,
      metadata,
      location: { type: 'Point', coordinates: [location.longitude, location.latitude] },
      latitude: location.latitude,
      longitude: location.longitude,
      sizeUnit: dto.sizeUnit as SizeUnit,
      sizeLength: dto.sizeLength,
      sizeBreadth: dto.sizeBreadth,
      sizeHeight: dto.sizeHeight,
      weightKg: dto.weightKg,
    });

    const saved = await this.items.save(entity);

    // Attempt to generate and upload a QR PNG to Cloudinary.
    // If it fails, fall back to a computed URL based on ITEM_QR_BASE_URL.
    try {
      const uploadedUrl = await this.qrImage.generateAndUploadItemQrPng(saved.id);
      if (uploadedUrl) {
        saved.qrCodeUrl = uploadedUrl;
        await this.items.update(saved.id, { qrCodeUrl: saved.qrCodeUrl });
      }
    } catch (err) {
      this.logger.warn(`QR upload failed for item ${saved.id}: ${err instanceof Error ? err.message : err}`);
      if (!saved.qrCodeUrl) {
        saved.qrCodeUrl = this.buildQrCodeUrl(saved.id);
        await this.items.update(saved.id, { qrCodeUrl: saved.qrCodeUrl });
      }
    }

    // Compute CO2 estimate (non-blocking if it fails)
    try {
      const estimated = await this.co2.estimateSavedCo2Kg({
        weightKg: saved.weightKg ?? null,
        sizeUnit: (saved.sizeUnit as any) ?? null,
        sizeLength: saved.sizeLength ?? null,
        sizeBreadth: saved.sizeBreadth ?? null,
        sizeHeight: saved.sizeHeight ?? null,
      });
      if (typeof estimated === 'number') {
        saved.estimatedCo2SavedKg = estimated;
        await this.items.update(saved.id, { estimatedCo2SavedKg: estimated });
      }
    } catch (err) {
      this.logger.debug(`CO2 estimate failed for item ${saved.id}: ${err instanceof Error ? err.message : err}`);
    }

    return {
      id: saved.id,
      title: saved.title,
      status: saved.status,
      pickup_option: saved.pickupOption,
      estimated_co2_saved_kg:
        typeof saved.estimatedCo2SavedKg === 'number' && Number.isFinite(saved.estimatedCo2SavedKg)
          ? Number(saved.estimatedCo2SavedKg)
          : null,
      location: {
        address_line: saved.addressLine,
        postcode: saved.postcode,
        latitude: saved.latitude,
        longitude: saved.longitude,
      },
      qr_code: saved.qrCodeUrl,
      created_at: saved.createdAt.toISOString(),
    };
  }

  private displayName(user: User): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    if (name) return name;
    if (typeof user.email === 'string') return user.email.split('@')[0];
    return '';
  }

  private async buildOwnerDetails(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) return null;
    const kyc = await this.kycs.findOne({ where: { user: { id: userId } }, relations: { user: true } });
    const agg = await this.reviews
      .createQueryBuilder('r')
      .select('r.target_user_id', 'target_user_id')
      .addSelect('AVG(r.rating)::float', 'avg_rating')
      .addSelect('COUNT(1)', 'reviews_count')
      .where('r.target_user_id = :uid', { uid: userId })
      .groupBy('r.target_user_id')
      .getRawOne<{ avg_rating: number; reviews_count: string }>();
    const rating = agg ? Math.round(Number(agg.avg_rating) * 10) / 10 : 0;
    const reviewsCount = agg ? Number(agg.reviews_count) : 0;

    return {
      id: user.id,
      name: this.displayName(user),
      profile_image: user.profileImageUrl ?? null,
      verification: {
        email_verified: user.status === UserStatus.ACTIVE,
        identity_verified: kyc?.status === KycStatus.APPROVED,
        address_verified: (await (async () => {
          try {
            const rows: any[] = await this.items.query('SELECT COUNT(1) AS cnt FROM address WHERE user_id = $1', [user.id]);
            return Number(rows?.[0]?.cnt || 0) > 0;
          } catch {
            return false;
          }
        })()),
      },
      rating,
      reviews_count: reviewsCount,
    };
  }

  async getPublicItem(rawId: string, currentUserId?: string) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) {
      throw new BadRequestException('Item id is required');
    }

    const item = await this.items.findOne({ where: { id }, relations: { donor: true } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    if (!PUBLIC_ITEM_STATUSES.includes(item.status)) {
      throw new NotFoundException('Item not found');
    }

    const images = this.normalizeImagesForOutput(item.images);
    const metadata = this.sanitizeMetadata(item.metadata ?? undefined);
    const scanEvents = await this.fetchScanEvents(item.id);

    const latitude =
      typeof item.latitude === 'number' && Number.isFinite(item.latitude)
        ? Number(item.latitude)
        : null;
    const longitude =
      typeof item.longitude === 'number' && Number.isFinite(item.longitude)
        ? Number(item.longitude)
        : null;

    const createdAt =
      item.createdAt instanceof Date && !Number.isNaN(item.createdAt.getTime())
        ? item.createdAt.toISOString()
        : new Date(item.createdAt as unknown as string).toISOString();

    const owner = item.donor ? await this.buildOwnerDetails(item.donor.id) : null;
    const dropoffLocation = await this.loadDropoffLocation(item.dropoffLocationId);

    // If a user context is provided, best-effort load their claim for this item
    let userClaim: Claim | null = null;
    if (currentUserId && typeof currentUserId === 'string') {
      try {
        const found = await this.claims.findOne({
          where: { item: { id }, collector: { id: currentUserId } },
        });
        userClaim = found ?? null;
      } catch {
        userClaim = null;
      }
    }

    return {
      id: item.id,
      title: typeof item.title === 'string' ? item.title.trim() : item.title,
      description:
        typeof item.description === 'string' && item.description.trim()
          ? item.description.trim()
          : null,
      status: item.status,
      condition: item.condition,
      category: item.category,
      estimated_co2_saved_kg:
        typeof item.estimatedCo2SavedKg === 'number' && Number.isFinite(item.estimatedCo2SavedKg)
          ? Number(item.estimatedCo2SavedKg)
          : null,
      location: {
        postcode:
          typeof item.postcode === 'string'
            ? item.postcode.trim().toUpperCase().slice(0, 32) || null
            : null,
        latitude,
        longitude,
      },
      qr_code:
        typeof item.qrCodeUrl === 'string' && item.qrCodeUrl.trim()
          ? item.qrCodeUrl.trim()
          : this.buildQrCodeUrl(item.id),
      scan_events: scanEvents,
      images,
      pickup_option: item.pickupOption,
      metadata,
      created_at: createdAt,
      owner,
      dropoff_location: dropoffLocation,
      claim: userClaim
        ? {
            status: userClaim.status,
            requested_at: this.formatDate(userClaim.createdAt),
            claimed_at: this.formatDate(userClaim.completedAt),
          }
        : null,
    };
  }

  async updateItem(userId: string, rawId: string, dto: UpdateItemDto) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) {
      throw new BadRequestException('Item id is required');
    }

    if (!dto || Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('Provide at least one field to update');
    }

    const item = await this.items.findOne({ where: { id }, relations: { donor: true } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (!item.donor || item.donor.id !== userId) {
      throw new ForbiddenException('You do not have permission to modify this item');
    }
    if (!EDITABLE_ITEM_STATUSES.includes(item.status)) {
      throw new BadRequestException('Item can no longer be edited');
    }

    if (dto.title !== undefined) {
      item.title = dto.title;
    }
    if (dto.description !== undefined) {
      item.description = dto.description ? dto.description : null;
    }
    if (dto.condition !== undefined) {
      item.condition = dto.condition;
    }
    if (dto.category !== undefined) {
      item.category = dto.category;
    }
    if (dto.deliveryPreferences !== undefined) {
      item.deliveryPreferences = dto.deliveryPreferences ? dto.deliveryPreferences : null;
    }
    if (dto.dropoffLocationId !== undefined) {
      item.dropoffLocationId = dto.dropoffLocationId ?? null;
    }
    if (dto.metadata !== undefined) {
      item.metadata = this.sanitizeMetadata(dto.metadata);
    }
    let recalcCo2 = false;
    if (dto.sizeUnit !== undefined) {
      item.sizeUnit = dto.sizeUnit as SizeUnit;
      recalcCo2 = true;
    }
    if (dto.sizeLength !== undefined) {
      const v = Number(dto.sizeLength);
      if (!Number.isFinite(v) || v < 0) throw new BadRequestException('size_length must be a non-negative number');
      item.sizeLength = v;
      recalcCo2 = true;
    }
    if (dto.sizeBreadth !== undefined) {
      const v = Number(dto.sizeBreadth);
      if (!Number.isFinite(v) || v < 0) throw new BadRequestException('size_breadth must be a non-negative number');
      item.sizeBreadth = v;
      recalcCo2 = true;
    }
    if (dto.sizeHeight !== undefined) {
      const v = Number(dto.sizeHeight);
      if (!Number.isFinite(v) || v < 0) throw new BadRequestException('size_height must be a non-negative number');
      item.sizeHeight = v;
      recalcCo2 = true;
    }
    if (dto.weightKg !== undefined) {
      const v = Number(dto.weightKg);
      if (!Number.isFinite(v) || v < 0) throw new BadRequestException('weight_kg must be a non-negative number');
      item.weightKg = v;
      recalcCo2 = true;
    }
    if (dto.images !== undefined) {
      item.images = this.normalizeImagesForPersistence(dto.images);
    }

    if (dto.addressLine !== undefined || dto.postcode !== undefined) {
      const addressLine = dto.addressLine ?? item.addressLine;
      const postcode = dto.postcode ?? item.postcode;
      if (!addressLine || !postcode) {
        throw new BadRequestException('address_line and postcode are required when updating the location');
      }
      // Re-geocode by postcode only (postcode has priority)
      let location: ItemLocation;
      try {
        location = await this.geocoding.forwardGeocode(postcode);
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        throw new ServiceUnavailableException('Failed to geocode updated address');
      }

      

      item.addressLine = addressLine;
      item.postcode = postcode;
      item.location = { type: 'Point', coordinates: [location.longitude, location.latitude] } as any;
      item.latitude = location.latitude;
      item.longitude = location.longitude;
    }

    const saved = await this.items.save(item);

    if (recalcCo2) {
      try {
        const estimated = await this.co2.estimateSavedCo2Kg({
          weightKg: saved.weightKg ?? null,
          sizeUnit: (saved.sizeUnit as any) ?? null,
          sizeLength: saved.sizeLength ?? null,
          sizeBreadth: saved.sizeBreadth ?? null,
          sizeHeight: saved.sizeHeight ?? null,
        });
        if (typeof estimated === 'number') {
          saved.estimatedCo2SavedKg = estimated;
          await this.items.update(saved.id, { estimatedCo2SavedKg: estimated });
        }
      } catch (err) {
        this.logger.debug(
          `CO2 estimate failed during update for item ${saved.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return {
      id: saved.id,
      title: saved.title,
      condition: saved.condition,
      postcode: saved.postcode,
      latitude: saved.latitude,
      longitude: saved.longitude,
      updated_at: saved.updatedAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  async deleteItem(userId: string, rawId: string) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) {
      throw new BadRequestException('Item id is required');
    }

    const item = await this.items.findOne({ where: { id }, relations: { donor: true } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (!item.donor || item.donor.id !== userId) {
      throw new ForbiddenException('You do not have permission to modify this item');
    }
    if (!DELETABLE_ITEM_STATUSES.includes(item.status)) {
      throw new BadRequestException('Item can no longer be deleted safely');
    }

    await this.items.remove(item);
  }

  async searchPublicListings(dto: SearchItemsDto, currentUserId?: string) {
    // If postcode is provided, it has priority over lat/lng
    const pc = (dto.postcode ?? '').trim();
    let originLat: number | undefined = undefined;
    let originLng: number | undefined = undefined;
    if (pc) {
      try {
        const located = await this.geocoding.forwardGeocode(pc);
        originLat = located.latitude;
        originLng = located.longitude;
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        throw new ServiceUnavailableException('Failed to resolve postcode to coordinates');
      }
    } else {
      originLat = typeof dto.lat === 'number' && Number.isFinite(dto.lat) ? dto.lat : undefined;
      originLng = typeof dto.lng === 'number' && Number.isFinite(dto.lng) ? dto.lng : undefined;
      if (originLat === undefined || originLng === undefined) {
        throw new BadRequestException('Provide either lat/lng or postcode to search items');
      }
    }

    if (
      typeof originLat !== 'number' ||
      typeof originLng !== 'number' ||
      !Number.isFinite(originLat) ||
      !Number.isFinite(originLng)
    ) {
      throw new BadRequestException('Valid latitude and longitude are required');
    }

    let radiusKm =
      typeof dto.radius === 'number' && Number.isFinite(dto.radius) ? dto.radius : DEFAULT_RADIUS_KM;
    radiusKm = Math.min(Math.max(radiusKm, MIN_RADIUS_KM), MAX_RADIUS_KM);
    const radiusMeters = radiusKm * 1000;

    let limit =
      typeof dto.limit === 'number' && Number.isFinite(dto.limit) ? dto.limit : DEFAULT_LIMIT;
    limit = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);

    let page =
      typeof dto.page === 'number' && Number.isFinite(dto.page) ? dto.page : DEFAULT_PAGE;
    page = Math.min(Math.max(Math.trunc(page), 1), MAX_PAGE);
    const offset = (page - 1) * limit;

    const requestedStatus = typeof dto.status === 'string' ? (dto.status as ItemStatus) : null;
    const statusFilters = requestedStatus
      ? [requestedStatus]
      : [ItemStatus.ACTIVE, ItemStatus.AWAITING_COLLECTION];
    const invalidStatus = statusFilters.find((status) => !PUBLIC_ITEM_STATUSES.includes(status));
    if (invalidStatus) {
      throw new BadRequestException('Requested status is not available for public listings');
    }

    const pointExpr = 'ST_SetSRID(ST_MakePoint(:originLng, :originLat), 4326)';
    const geographyPoint = `${pointExpr}::geography`;

    const qb = this.items
      .createQueryBuilder('item')
      .select('item.id', 'id')
      .addSelect('item.title', 'title')
      .addSelect('item.status', 'status')
      .addSelect('item.condition', 'condition')
      .addSelect('item.category', 'category')
      .addSelect('item.pickup_option', 'pickup_option')
      .addSelect('item.qr_code_url', 'qr_code_url')
      .addSelect('item.donor_id', 'donor_id')
      .addSelect('item.dropoff_location_id', 'dropoff_location_id')
      .addSelect('item.estimated_co2_saved_kg', 'estimated_co2_saved_kg')
      .addSelect('item.images', 'images')
      .addSelect('item.created_at', 'created_at')
      .addSelect(`ST_Distance(item.location::geography, ${geographyPoint})`, 'distance_meters')
      .where('item.status IN (:...statuses)', { statuses: statusFilters })
      .andWhere(`ST_DWithin(item.location::geography, ${geographyPoint}, :radiusMeters)`)
      .orderBy('distance_meters', 'ASC')
      .offset(offset)
      .limit(limit)
      .setParameters({
        originLat,
        originLng,
        radiusMeters,
      });

    if (dto.category) {
      const normalizedCategory = dto.category.trim().toLowerCase();
      if (normalizedCategory.length > 0) {
        qb.andWhere('LOWER(item.category) = :category', { category: normalizedCategory });
      }
    }

    const rows = await qb.getRawMany();
    const dropoffMap = await this.loadDropoffLocations(rows.map((row: any) => row.dropoff_location_id));

    const donorIds = Array.from(new Set(rows.map((r: any) => r.donor_id).filter(Boolean)));
    const donors = donorIds.length
      ? await this.users
          .createQueryBuilder('u')
          .select(['u.id', 'u.firstName', 'u.lastName', 'u.email', 'u.status', 'u.profileImageUrl'])
          .where('u.id IN (:...ids)', { ids: donorIds })
          .getMany()
      : [];
    const donorMap = new Map(donors.map((u) => [u.id, u]));

    const kycRows = donorIds.length
      ? await this.kycs
          .createQueryBuilder('k')
          .select(['k.user_id AS user_id', 'k.status AS status'])
          .where('k.user_id IN (:...ids)', { ids: donorIds })
          .getRawMany<{ user_id: string; status: KycStatus }>()
      : [];
    const kycMap = new Map<string, KycStatus>(kycRows.map((r) => [r.user_id, r.status]));

    // Address presence per donor (raw SQL; table may not exist in all setups)
    let addrMap = new Map<string, number>();
    if (donorIds.length) {
      try {
        const rowsAddr: any[] = await this.items.query(
          `SELECT user_id, COUNT(1) AS cnt FROM address WHERE user_id = ANY($1) GROUP BY user_id`,
          [donorIds],
        );
        addrMap = new Map(rowsAddr.map((r) => [String(r.user_id), Number(r.cnt)]));
      } catch {
        addrMap = new Map();
      }
    }

    const ratingAgg = donorIds.length
      ? await this.reviews
          .createQueryBuilder('r')
          .select('r.target_user_id', 'user_id')
          .addSelect('AVG(r.rating)::float', 'avg_rating')
          .addSelect('COUNT(1)', 'reviews_count')
          .where('r.target_user_id IN (:...ids)', { ids: donorIds })
          .groupBy('r.target_user_id')
          .getRawMany<{ user_id: string; avg_rating: number; reviews_count: string }>()
      : [];
    const ratingMap = new Map<string, { rating: number; count: number }>(
      ratingAgg.map((r) => [r.user_id, { rating: Math.round(Number(r.avg_rating) * 10) / 10, count: Number(r.reviews_count) }]),
    );

    // If an authenticated user is present, load their claims for these items
    let userClaimMap = new Map<string, Claim>();
    if (currentUserId && rows.length) {
      const itemIds = Array.from(new Set(rows.map((r: any) => r.id)));
      const userClaims = await this.claims.find({
        where: { collector: { id: currentUserId }, item: { id: In(itemIds) } },
      });
      userClaimMap = new Map(userClaims.map((c) => [c.item.id, c]));
    }

    const items = rows.map((row: any) => {
      const rawDistance = Number(row.distance_meters);
      const distanceKm = Number.isFinite(rawDistance)
        ? Math.round((Math.max(rawDistance, 0) / 1000) * 10) / 10
        : null;

      let parsedImages: any[] = [];
      const rawImages = row.images;
      if (Array.isArray(rawImages)) {
        parsedImages = rawImages;
      } else if (typeof rawImages === 'string') {
        try {
          const candidate = JSON.parse(rawImages);
          if (Array.isArray(candidate)) {
            parsedImages = candidate;
          }
        } catch {
          parsedImages = [];
        }
      }
      const images = this.normalizeImagesForOutput(parsedImages);

      const createdAtRaw = row.created_at;
      let createdAtIso: string | null = null;
      if (createdAtRaw instanceof Date && !Number.isNaN(createdAtRaw.getTime())) {
        createdAtIso = createdAtRaw.toISOString();
      } else if (createdAtRaw) {
        const parsedDate = new Date(createdAtRaw);
        if (!Number.isNaN(parsedDate.getTime())) {
          createdAtIso = parsedDate.toISOString();
        }
      }

      const qrCode =
        typeof row.qr_code_url === 'string' && row.qr_code_url.trim()
          ? row.qr_code_url.trim()
          : this.buildQrCodeUrl(row.id);

      const title = typeof row.title === 'string' ? row.title.trim() : '';

      const donor = donorMap.get(row.donor_id);
      const owner = donor
        ? {
            id: donor.id,
            name: this.displayName(donor),
            profile_image: donor.profileImageUrl ?? null,
            verification: {
              email_verified: donor.status === UserStatus.ACTIVE,
              identity_verified: kycMap.get(donor.id) === KycStatus.APPROVED,
              address_verified: (addrMap.get(donor.id) ?? 0) > 0,
            },
            rating: ratingMap.get(donor.id)?.rating ?? 0,
            reviews_count: ratingMap.get(donor.id)?.count ?? 0,
          }
        : null;

      const dropoffLocation = dropoffMap.get(this.sanitizeShopId(row.dropoff_location_id)) ?? null;

      const claim = userClaimMap.get(row.id);

      return {
        id: row.id,
        title,
        status: row.status,
        condition: row.condition,
        category: row.category,
        distance_km: distanceKm ?? null,
        pickup_option: row.pickup_option,
        qr_code: qrCode,
        images,
        estimated_co2_saved_kg:
          typeof row.estimated_co2_saved_kg === 'number' && Number.isFinite(row.estimated_co2_saved_kg)
            ? Number(row.estimated_co2_saved_kg)
            : row.estimated_co2_saved_kg === null
            ? null
            : Number(row.estimated_co2_saved_kg || 0) || null,
        owner,
        dropoff_location: dropoffLocation,
        created_at: createdAtIso,
        claim: claim
          ? {
              status: claim.status,
              requested_at: this.formatDate(claim.createdAt),
              claimed_at: this.formatDate(claim.completedAt),
            }
          : null,
      };
    });

    return {
      search_origin: {
        lat: Number(originLat.toFixed(6)),
        lng: Number(originLng.toFixed(6)),
        radius_km: Math.round(radiusKm * 10) / 10,
      },
      items,
    };
  }
}
