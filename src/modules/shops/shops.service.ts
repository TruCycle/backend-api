import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { GeoService } from '../../geo/geo.service';
import { RoleCode } from '../users/role.entity';
import { userHasRole } from '../users/role.utils';
import { User, UserStatus } from '../users/user.entity';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import { Item, ItemPickupOption, ItemStatus } from '../items/item.entity';
import { Claim } from '../claims/claim.entity';
import { ShopItemsQueryDto } from './dto/shop-items-query.dto';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { Shop } from './shop.entity';

@Injectable()
export class ShopsService {
  constructor(
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(Claim) private readonly claims: Repository<Claim>,
    private readonly geo: GeoService,
    private readonly geocoding: ItemGeocodingService,
  ) {}

  private async resolveActor(authPayload: any): Promise<{ user: User; isAdmin: boolean }> {
    if (!authPayload || typeof authPayload.sub !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    const actorId = authPayload.sub.trim();
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    const user = await this.users.findOne({ where: { id: actorId } });
    if (!user) {
      throw new UnauthorizedException('User record not found');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Inactive users cannot manage shops');
    }
    const isAdmin = userHasRole(authPayload, RoleCode.ADMIN);
    return { user, isAdmin };
  }

  private ensurePartnerActor(payload: any): void {
    if (userHasRole(payload, RoleCode.ADMIN)) return;
    if (!userHasRole(payload, RoleCode.PARTNER)) {
      throw new ForbiddenException('Partners only');
    }
  }

  async createShop(authPayload: any, dto: CreateShopDto) {
    const { user } = await this.resolveActor(authPayload);
    this.ensurePartnerActor(authPayload);

    const lat = Number(dto.latitude);
    const lon = Number(dto.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new BadRequestException('Invalid coordinates');
    }

    const entity = this.shops.create({
      owner: user,
      name: dto.name,
      phoneNumber: dto.phoneNumber,
      addressLine: dto.addressLine,
      postcode: dto.postcode,
      latitude: lat,
      longitude: lon,
      openingHours: dto.openingHours
        ? { days: dto.openingHours.days, open_time: dto.openingHours.open_time, close_time: dto.openingHours.close_time }
        : undefined,
      acceptableCategories: dto.acceptableCategories,
      // Geometry is set via raw SQL on insert/update, but we keep a copy here for symmetry
      geom: { type: 'Point', coordinates: [lon, lat] } as any,
    });
    const saved = await this.shops.save(entity);
    return this.view(saved);
  }

  async listMyShops(authPayload: any) {
    const { user } = await this.resolveActor(authPayload);
    this.ensurePartnerActor(authPayload);
    const rows = await this.shops.find({ where: { owner: { id: user.id } }, order: { createdAt: 'DESC' } });
    return rows.map((r) => this.view(r));
  }

  async getShopPublic(id: string) {
    const shop = await this.shops.findOne({ where: { id } });
    if (!shop || shop.active === false) throw new NotFoundException('Shop not found');
    return this.view(shop);
  }

  async updateShop(authPayload: any, id: string, dto: UpdateShopDto) {
    const { user, isAdmin } = await this.resolveActor(authPayload);
    this.ensurePartnerActor(authPayload);
    const shop = await this.shops.findOne({ where: { id }, relations: { owner: true } });
    if (!shop) throw new NotFoundException('Shop not found');
    if (!isAdmin && shop.owner.id !== user.id) throw new ForbiddenException('Not the owner');

    if (dto.name !== undefined) shop.name = dto.name;
    if (dto.phoneNumber !== undefined) shop.phoneNumber = dto.phoneNumber;
    if (dto.addressLine !== undefined) shop.addressLine = dto.addressLine;
    if (dto.postcode !== undefined) shop.postcode = dto.postcode;
    if (dto.latitude !== undefined) shop.latitude = Number(dto.latitude);
    if (dto.longitude !== undefined) shop.longitude = Number(dto.longitude);
    if (dto.openingHours !== undefined) {
      shop.openingHours = dto.openingHours
        ? { days: dto.openingHours.days, open_time: dto.openingHours.open_time, close_time: dto.openingHours.close_time }
        : null;
    }
    if (dto.acceptableCategories !== undefined) shop.acceptableCategories = dto.acceptableCategories ?? null;
    if (dto.latitude !== undefined || dto.longitude !== undefined) {
      if (!Number.isFinite(shop.latitude) || !Number.isFinite(shop.longitude)) {
        throw new BadRequestException('Invalid coordinates');
      }
      shop.geom = { type: 'Point', coordinates: [shop.longitude, shop.latitude] } as any;
    }
    if (dto.active !== undefined) shop.active = !!dto.active;

    const saved = await this.shops.save(shop);
    return this.view(saved);
  }

  async deleteShop(authPayload: any, id: string): Promise<void> {
    const { user, isAdmin } = await this.resolveActor(authPayload);
    this.ensurePartnerActor(authPayload);
    const shop = await this.shops.findOne({ where: { id }, relations: { owner: true } });
    if (!shop) return; // idempotent
    if (!isAdmin && shop.owner.id !== user.id) throw new ForbiddenException('Not the owner');
    shop.active = false;
    await this.shops.save(shop);
  }

  // lon/lat in degrees; radiusMeters optional, default 2000m
  async findNearby(lon: number, lat: number, radiusMeters?: number) {
    const radiusDeg = typeof radiusMeters === 'number' && radiusMeters > 0 ? radiusMeters / 1000 / 111 : 0.05;
    const rows = await this.geo.nearestShops(lon, lat, radiusDeg);
    // rows: id, name, geom (GeoJSON string), distance
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      distanceMeters: Number(r.distance) || null,
    }));
  }

  // Convenience: geocode postcode/address and reuse coordinate search
  async findNearbyByPostcode(postcode: string, radiusMeters?: number) {
    const trimmed = (postcode ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('postcode is required');
    }
    const loc = await this.geocoding.forwardGeocode(trimmed);
    return this.findNearby(loc.longitude, loc.latitude, radiusMeters);
  }

  private view(s: Shop) {
    return {
      id: s.id,
      name: s.name,
      phone_number: s.phoneNumber ?? null,
      address_line: s.addressLine,
      postcode: s.postcode,
      latitude: s.latitude,
      longitude: s.longitude,
      opening_hours: s.openingHours ?? null,
      acceptable_categories: s.acceptableCategories ?? [],
      active: s.active,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    };
  }

  private normalizeImagesForOutput(raw: any): { url: string; alt_text: string | null }[] {
    const output: { url: string; alt_text: string | null }[] = [];
    if (!raw) return output;
    let candidate: any[] = [];
    if (Array.isArray(raw)) candidate = raw;
    else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) candidate = parsed;
      } catch {
        return output;
      }
    }
    const seen = new Set<string>();
    for (const entry of candidate) {
      if (!entry) continue;
      let url: string | null = null;
      let alt: string | null = null;
      if (typeof entry === 'string') url = entry;
      else if (typeof entry === 'object') {
        if (typeof entry.url === 'string') url = entry.url;
        if (typeof entry.altText === 'string') {
          const t = entry.altText.trim().slice(0, 120);
          alt = t ? t : null;
        }
      }
      if (typeof url !== 'string') continue;
      const trimmed = url.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      if (!/^https?:\/\//i.test(trimmed)) continue;
      seen.add(trimmed);
      output.push({ url: trimmed, alt_text: alt });
      if (output.length >= 10) break;
    }
    return output;
  }

  private buildQrCodeUrl(id: string): string {
    const base = (process.env.ITEM_QR_BASE_URL || 'https://cdn.trucycle.com/qrs').replace(/\/$/, '');
    return `${base}/item-${id}.png`;
  }

  private formatDate(input?: Date | string | null): string | null {
    if (!input) return null;
    if (input instanceof Date && !Number.isNaN(input.getTime())) return input.toISOString();
    const d = new Date(String(input));
    return !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  }

  async listShopItems(authPayload: any, rawShopId: string, dto: ShopItemsQueryDto) {
    const { user, isAdmin } = await this.resolveActor(authPayload);
    const shop = await this.shops.findOne({ where: { id: rawShopId }, relations: { owner: true } });
    if (!shop) throw new NotFoundException('Shop not found');
    if (!isAdmin && shop.owner.id !== user.id) throw new ForbiddenException('Not the owner');

    const limitRaw = dto?.limit;
    let limit = typeof limitRaw === 'number' && Number.isFinite(limitRaw) ? limitRaw : 10;
    limit = Math.min(Math.max(Math.trunc(limit), 1), 50);

    const pageRaw = dto?.page;
    let page = typeof pageRaw === 'number' && Number.isFinite(pageRaw) ? pageRaw : 1;
    page = Math.min(Math.max(Math.trunc(page), 1), 100);
    const offset = (page - 1) * limit;

    const qb = this.items
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.donor', 'donor')
      .where('item.dropoff_location_id = :shopId', { shopId: shop.id })
      .orderBy('item.createdAt', 'DESC')
      .skip(offset)
      .take(limit);

    if (dto?.status) qb.andWhere('item.status = :status', { status: dto.status as ItemStatus });
    if (dto?.pickup_option) qb.andWhere('item.pickup_option = :pickup', { pickup: dto.pickup_option as ItemPickupOption });
    if (dto?.category && dto.category.trim())
      qb.andWhere('LOWER(item.category) = :cat', { cat: dto.category.trim().toLowerCase() });
    if (dto?.created_from) qb.andWhere('item.created_at >= :from', { from: new Date(dto.created_from) });
    if (dto?.created_to) qb.andWhere('item.created_at <= :to', { to: new Date(dto.created_to) });

    const [rows, total] = await qb.getManyAndCount();

    const itemIds = rows.map((it) => it.id);
    const claimRows = itemIds.length > 0 ? await this.claims.find({ where: { item: { id: In(itemIds) } } }) : [];
    const claimMap = new Map<string, Claim>(claimRows.map((c) => [c.item.id, c]));

    const items = rows.map((item) => {
      const images = this.normalizeImagesForOutput(item.images);
      const qrCode = typeof item.qrCodeUrl === 'string' && item.qrCodeUrl.trim() ? item.qrCodeUrl.trim() : this.buildQrCodeUrl(item.id);
      const latitude =
        typeof item.latitude === 'number' && Number.isFinite(item.latitude) ? Number(item.latitude) : null;
      const longitude =
        typeof item.longitude === 'number' && Number.isFinite(item.longitude) ? Number(item.longitude) : null;
      const claim = claimMap.get(item.id) || null;
      return {
        id: item.id,
        title: typeof item.title === 'string' ? item.title.trim() : '',
        status: item.status,
        pickup_option: item.pickupOption,
        qr_code: qrCode,
        images,
        estimated_co2_saved_kg:
          typeof (item as any).estimatedCo2SavedKg === 'number' && Number.isFinite((item as any).estimatedCo2SavedKg)
            ? Number((item as any).estimatedCo2SavedKg)
            : null,
        metadata: item.metadata ?? null,
        location: {
          address_line: typeof item.addressLine === 'string' && item.addressLine.trim() ? item.addressLine.trim() : null,
          postcode: typeof item.postcode === 'string' && item.postcode.trim() ? item.postcode.trim().toUpperCase() : null,
          latitude,
          longitude,
        },
        created_at: this.formatDate(item.createdAt),
        claim: claim
          ? {
              id: claim.id,
              status: claim.status,
              approved_at: this.formatDate(claim.approvedAt),
              completed_at: this.formatDate(claim.completedAt),
              collector: claim.collector
                ? {
                    id: claim.collector.id,
                    name: [claim.collector.firstName, claim.collector.lastName].filter(Boolean).join(' ').trim() ||
                      (typeof claim.collector.email === 'string' ? claim.collector.email.split('@')[0] : ''),
                    profile_image: claim.collector.profileImageUrl ?? null,
                  }
                : null,
            }
          : null,
      };
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      items,
      pagination: { page, limit, total, total_pages: totalPages },
    };
  }

  async listMyShopItems(authPayload: any, dto: ShopItemsQueryDto) {
    const { user } = await this.resolveActor(authPayload);
    this.ensurePartnerActor(authPayload);

    const myShops = await this.shops.find({ where: { owner: { id: user.id } } });
    if (!myShops.length) {
      return { items: [], pagination: { page: 1, limit: dto?.limit ?? 10, total: 0, total_pages: 0 } };
    }
    const shopIds = myShops.map((s) => s.id);

    const limitRaw = dto?.limit;
    let limit = typeof limitRaw === 'number' && Number.isFinite(limitRaw) ? limitRaw : 10;
    limit = Math.min(Math.max(Math.trunc(limit), 1), 50);

    const pageRaw = dto?.page;
    let page = typeof pageRaw === 'number' && Number.isFinite(pageRaw) ? pageRaw : 1;
    page = Math.min(Math.max(Math.trunc(page), 1), 100);
    const offset = (page - 1) * limit;

    const qb = this.items
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.donor', 'donor')
      .where('item.dropoff_location_id IN (:...shopIds)', { shopIds })
      .orderBy('item.createdAt', 'DESC')
      .skip(offset)
      .take(limit);

    if (dto?.status) qb.andWhere('item.status = :status', { status: dto.status as ItemStatus });
    if (dto?.pickup_option) qb.andWhere('item.pickup_option = :pickup', { pickup: dto.pickup_option as ItemPickupOption });
    if (dto?.category && dto.category.trim())
      qb.andWhere('LOWER(item.category) = :cat', { cat: dto.category.trim().toLowerCase() });
    if (dto?.created_from) qb.andWhere('item.created_at >= :from', { from: new Date(dto.created_from) });
    if (dto?.created_to) qb.andWhere('item.created_at <= :to', { to: new Date(dto.created_to) });

    const [rows, total] = await qb.getManyAndCount();

    const itemIds = rows.map((it) => it.id);
    const claimRows = itemIds.length > 0 ? await this.claims.find({ where: { item: { id: In(itemIds) } } }) : [];
    const claimMap = new Map<string, Claim>(claimRows.map((c) => [c.item.id, c]));

    const items = rows.map((item) => {
      const images = this.normalizeImagesForOutput(item.images);
      const qrCode = typeof item.qrCodeUrl === 'string' && item.qrCodeUrl.trim() ? item.qrCodeUrl.trim() : this.buildQrCodeUrl(item.id);
      const latitude =
        typeof item.latitude === 'number' && Number.isFinite(item.latitude) ? Number(item.latitude) : null;
      const longitude =
        typeof item.longitude === 'number' && Number.isFinite(item.longitude) ? Number(item.longitude) : null;
      const claim = claimMap.get(item.id) || null;
      return {
        id: item.id,
        title: typeof item.title === 'string' ? item.title.trim() : '',
        status: item.status,
        pickup_option: item.pickupOption,
        qr_code: qrCode,
        images,
        estimated_co2_saved_kg:
          typeof (item as any).estimatedCo2SavedKg === 'number' && Number.isFinite((item as any).estimatedCo2SavedKg)
            ? Number((item as any).estimatedCo2SavedKg)
            : null,
        metadata: item.metadata ?? null,
        location: {
          address_line: typeof item.addressLine === 'string' && item.addressLine.trim() ? item.addressLine.trim() : null,
          postcode: typeof item.postcode === 'string' && item.postcode.trim() ? item.postcode.trim().toUpperCase() : null,
          latitude,
          longitude,
        },
        created_at: this.formatDate(item.createdAt),
        claim: claim
          ? {
              id: claim.id,
              status: claim.status,
              approved_at: this.formatDate(claim.approvedAt),
              completed_at: this.formatDate(claim.completedAt),
              collector: claim.collector
                ? {
                    id: claim.collector.id,
                    name: [claim.collector.firstName, claim.collector.lastName].filter(Boolean).join(' ').trim() ||
                      (typeof claim.collector.email === 'string' ? claim.collector.email.split('@')[0] : ''),
                    profile_image: claim.collector.profileImageUrl ?? null,
                  }
                : null,
            }
          : null,
      };
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      items,
      pagination: { page, limit, total, total_pages: totalPages },
    };
  }
}
