import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ServiceZone } from '../addresses/service-zone.entity';
import { User, UserStatus } from '../users/user.entity';

import { CreateItemDto, CreateItemImageDto } from './dto/create-item.dto';
import { SearchItemsDto } from './dto/search-items.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemGeocodingService } from './item-geocoding.service';
import { ItemLocation } from './item-location.interface';
import { Item, ItemPickupOption, ItemStatus } from './item.entity';

const DEFAULT_RADIUS_KM = 5;
const MIN_RADIUS_KM = 0.1;
const MAX_RADIUS_KM = 50;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_PAGE = 1;
const MAX_PAGE = 100;
const PUBLIC_ITEM_STATUSES: readonly ItemStatus[] = [
  ItemStatus.ACTIVE,
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

@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

  constructor(
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ServiceZone) private readonly zones: Repository<ServiceZone>,
    private readonly geocoding: ItemGeocodingService,
  ) {}

  private readonly qrBaseUrl = (process.env.ITEM_QR_BASE_URL || 'https://cdn.trucycle.com/qrs').replace(/\/$/, '');

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

  async createItem(userId: string, dto: CreateItemDto) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('User must have an active account to list items');
    }

    if (dto.pickupOption === ItemPickupOption.DONATE && !dto.dropoffLocationId) {
      throw new BadRequestException('dropoff_location_id is required for donate pickups');
    }

    const query = `${dto.addressLine}, ${dto.postcode}`;
    let location: ItemLocation;
    try {
      location = await this.geocoding.forwardGeocode(query);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new ServiceUnavailableException('Failed to geocode address');
    }

    const insideZone = await this.zones
      .createQueryBuilder('z')
      .where('z.active = true')
      .andWhere('ST_Contains(z.geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))', {
        lon: location.longitude,
        lat: location.latitude,
      })
      .getCount();

    if (insideZone === 0) {
      throw new BadRequestException('Address is outside the supported service area');
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
    });

    const saved = await this.items.save(entity);

    if (!saved.qrCodeUrl) {
      saved.qrCodeUrl = this.buildQrCodeUrl(saved.id);
      await this.items.update(saved.id, { qrCodeUrl: saved.qrCodeUrl });
    }

    return {
      id: saved.id,
      title: saved.title,
      status: saved.status,
      pickup_option: saved.pickupOption,
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

  async getPublicItem(rawId: string) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) {
      throw new BadRequestException('Item id is required');
    }

    const item = await this.items.findOne({ where: { id } });
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

    return {
      id: item.id,
      title: typeof item.title === 'string' ? item.title.trim() : item.title,
      description:
        typeof item.description === 'string' && item.description.trim()
          ? item.description.trim()
          : null,
      status: item.status,
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
    if (dto.images !== undefined) {
      item.images = this.normalizeImagesForPersistence(dto.images);
    }

    if (dto.addressLine !== undefined || dto.postcode !== undefined) {
      const addressLine = dto.addressLine ?? item.addressLine;
      const postcode = dto.postcode ?? item.postcode;
      if (!addressLine || !postcode) {
        throw new BadRequestException('address_line and postcode are required when updating the location');
      }
      let location: ItemLocation;
      try {
        location = await this.geocoding.forwardGeocode(`${addressLine}, ${postcode}`);
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        throw new ServiceUnavailableException('Failed to geocode updated address');
      }

      const insideZone = await this.zones
        .createQueryBuilder('z')
        .where('z.active = true')
        .andWhere('ST_Contains(z.geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))', {
          lon: location.longitude,
          lat: location.latitude,
        })
        .getCount();

      if (insideZone === 0) {
        throw new BadRequestException('Updated address is outside the supported service area');
      }

      item.addressLine = addressLine;
      item.postcode = postcode;
      item.location = { type: 'Point', coordinates: [location.longitude, location.latitude] } as any;
      item.latitude = location.latitude;
      item.longitude = location.longitude;
    }

    const saved = await this.items.save(item);

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

  async searchPublicListings(dto: SearchItemsDto) {
    let originLat =
      typeof dto.lat === 'number' && Number.isFinite(dto.lat) ? dto.lat : undefined;
    let originLng =
      typeof dto.lng === 'number' && Number.isFinite(dto.lng) ? dto.lng : undefined;

    if (originLat === undefined || originLng === undefined) {
      const postcode = dto.postcode;
      if (!postcode) {
        throw new BadRequestException('Provide either lat/lng or postcode to search items');
      }
      try {
        const located = await this.geocoding.forwardGeocode(postcode);
        originLat = located.latitude;
        originLng = located.longitude;
      } catch (err) {
        if (err instanceof BadRequestException) {
          throw err;
        }
        throw new ServiceUnavailableException('Failed to resolve postcode to coordinates');
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

    const statusFilter =
      typeof dto.status === 'string' ? (dto.status as ItemStatus) : ItemStatus.ACTIVE;
    if (!PUBLIC_ITEM_STATUSES.includes(statusFilter)) {
      throw new BadRequestException('Requested status is not available for public listings');
    }

    const pointExpr = 'ST_SetSRID(ST_MakePoint(:originLng, :originLat), 4326)';
    const geographyPoint = `${pointExpr}::geography`;

    const qb = this.items
      .createQueryBuilder('item')
      .select('item.id', 'id')
      .addSelect('item.title', 'title')
      .addSelect('item.status', 'status')
      .addSelect('item.pickup_option', 'pickup_option')
      .addSelect('item.qr_code_url', 'qr_code_url')
      .addSelect('item.images', 'images')
      .addSelect('item.created_at', 'created_at')
      .addSelect(`ST_Distance(item.location::geography, ${geographyPoint})`, 'distance_meters')
      .where('item.status = :status', { status: statusFilter })
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

      return {
        id: row.id,
        title,
        status: row.status,
        distance_km: distanceKm ?? null,
        pickup_option: row.pickup_option,
        qr_code: qrCode,
        images,
        created_at: createdAtIso,
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
