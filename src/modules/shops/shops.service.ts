import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import { validLocationPoint } from '../../common/utils/public-location';
import { GeoService } from '../../geo/geo.service';
import { Claim } from '../claims/claim.entity';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import { Item, ItemPickupOption, ItemStatus } from '../items/item.entity';
import { RoleCode } from '../users/role.entity';
import { User, UserStatus } from '../users/user.entity';

import { CreateShopDto } from './dto/create-shop.dto';
import { ShopItemsQueryDto } from './dto/shop-items-query.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { assertNoDuplicateShop, normalizeFullUkPostcode, normalizeShopIdentity, withShopOwnerLock } from './shop-validation';
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
    const dbIsAdmin = (user.userRoles ?? []).some(link => link.role?.code === RoleCode.ADMIN);
    const isAdmin = dbIsAdmin;
    return { user, isAdmin };
  }

  private async ensurePartnerActor(user: User): Promise<void> {
    const codes = (user.userRoles ?? []).map(link => link.role?.code);
    if (codes.includes(RoleCode.ADMIN) || codes.includes(RoleCode.PARTNER)) return;
    throw new ForbiddenException('Partners only');
  }

  async createShop(authPayload: any, dto: CreateShopDto) {
    const { user } = await this.resolveActor(authPayload);
    await this.ensurePartnerActor(user);
    const identity = normalizeShopIdentity(dto);
    // Postcode has first priority: resolve coordinates using postcode only
    const located = await this.geocoding.forwardGeocode(identity.postcode);
    const point = validLocationPoint(located.latitude, located.longitude);
    if (!point) throw new BadRequestException('Shop location could not be established');
    return withShopOwnerLock(this.shops.manager, user.id, async (manager, owner) => {
      await assertNoDuplicateShop(manager, owner.id, identity);
      const shops = manager.getRepository(Shop);
      const entity = shops.create({
      owner,
      ...identity,
      phoneNumber: dto.phoneNumber,
      operationalNotes: dto.operationalNotes,
      latitude: point.latitude,
      longitude: point.longitude,
      openingHours: dto.openingHours
        ? { days: dto.openingHours.days, open_time: dto.openingHours.open_time, close_time: dto.openingHours.close_time }
        : undefined,
      acceptableCategories: dto.acceptableCategories,
      // Geometry is set via raw SQL on insert/update, but we keep a copy here for symmetry
      geom: { type: 'Point', coordinates: [point.longitude, point.latitude] } as any,
    });
      const saved = await shops.save(entity);
      return this.view(saved, true);
    });
  }

  async listMyShops(authPayload: any) {
    const { user } = await this.resolveActor(authPayload);
    await this.ensurePartnerActor(user);
    const rows = await this.shops.find({ where: { owner: { id: user.id } }, order: { createdAt: 'DESC' } });
    return rows.map((r) => this.view(r, true));
  }

  async getShopPublic(id: string) {
    const shop = await this.shops.findOne({ where: { id } });
    if (!shop || shop.active === false) throw new NotFoundException('Shop not found');
    return this.view(shop);
  }

  async updateShop(authPayload: any, id: string, dto: UpdateShopDto) {
    const { user, isAdmin } = await this.resolveActor(authPayload);
    await this.ensurePartnerActor(user);
    if (dto.active !== undefined && typeof dto.active !== 'boolean') throw new BadRequestException('active must be a boolean');
    const snapshot = await this.shops.findOne({ where: { id }, relations: { owner: true } });
    if (!snapshot) throw new NotFoundException('Shop not found');
    if (!isAdmin && snapshot.owner.id !== user.id) throw new ForbiddenException('Not the owner');
    const changesLocation = dto.postcode !== undefined || dto.addressLine !== undefined;
    let located: { latitude: number; longitude: number } | null = null;
    if (changesLocation) {
      const identity = normalizeShopIdentity({ name: dto.name ?? snapshot.name,
        addressLine: dto.addressLine === undefined ? snapshot.addressLine : dto.addressLine,
        postcode: dto.postcode === undefined ? snapshot.postcode : dto.postcode });
      const result = await this.geocoding.forwardGeocode(identity.postcode);
      located = validLocationPoint(result.latitude, result.longitude);
      if (!located) throw new BadRequestException('Shop location could not be established');
    }
    return withShopOwnerLock(this.shops.manager, snapshot.owner.id, async (manager) => {
      const shops = manager.getRepository(Shop);
      const shop = await shops.findOne({ where: { id }, relations: { owner: true } });
      if (!shop || shop.owner.id !== snapshot.owner.id) throw new NotFoundException('Shop not found');
      if (changesLocation && (shop.postcode !== snapshot.postcode || shop.addressLine !== snapshot.addressLine)) {
        throw new ConflictException('Shop location changed while editing. Reload the shop and try again.');
      }
      const active = dto.active ?? shop.active;
      if (shop.active && !active) await this.requireAnotherActiveShop(manager);
      if (active || dto.name !== undefined || changesLocation) {
        const identity = normalizeShopIdentity({ name: dto.name === undefined ? shop.name : dto.name,
          addressLine: dto.addressLine === undefined ? shop.addressLine : dto.addressLine,
          postcode: dto.postcode === undefined ? shop.postcode : dto.postcode });
        if (active) await assertNoDuplicateShop(manager, shop.owner.id, identity, shop.id);
        Object.assign(shop, identity);
      }
      if (located) {
        shop.latitude = located.latitude; shop.longitude = located.longitude;
      } else if (dto.latitude !== undefined || dto.longitude !== undefined) {
        const point = validLocationPoint(dto.latitude === undefined ? shop.latitude : dto.latitude,
          dto.longitude === undefined ? shop.longitude : dto.longitude);
        if (!point) throw new BadRequestException('Invalid coordinates');
        shop.latitude = point.latitude; shop.longitude = point.longitude;
      }
      if (located || dto.latitude !== undefined || dto.longitude !== undefined) {
        shop.geom = { type: 'Point', coordinates: [shop.longitude, shop.latitude] } as any;
      }
      if (dto.phoneNumber !== undefined) shop.phoneNumber = dto.phoneNumber;
      if (dto.openingHours !== undefined) shop.openingHours = dto.openingHours
        ? { days: dto.openingHours.days, open_time: dto.openingHours.open_time, close_time: dto.openingHours.close_time } : null;
      if (dto.acceptableCategories !== undefined) shop.acceptableCategories = dto.acceptableCategories ?? null;
      if (dto.operationalNotes !== undefined) shop.operationalNotes = dto.operationalNotes ?? null;
      shop.active = active;
      return this.view(await shops.save(shop), true);
    }, { allowInactiveOwner: isAdmin });
  }
  async deleteShop(authPayload: any, id: string): Promise<void> {
    const { user, isAdmin } = await this.resolveActor(authPayload);
    await this.ensurePartnerActor(user);
    const shopId = typeof id === 'string' ? id.trim() : '';
    if (!shopId) {
      throw new BadRequestException('Shop id is required');
    }
    const where = isAdmin ? { id: shopId } : { id: shopId, owner: { id: user.id } };
    const shop = await this.shops.findOne({ where, relations: { owner: true } });
    if (!shop) {
      throw new NotFoundException('Shop not found or not owned by you');
    }
    await withShopOwnerLock(this.shops.manager, shop.owner.id, async manager => {
      const shops = manager.getRepository(Shop);
      const current = await shops.findOne({ where, relations: { owner: true } });
      if (!current) throw new NotFoundException('Shop not found');
      if (!current.active) return;
      await this.requireAnotherActiveShop(manager);
      current.active = false;
      await shops.save(current);
    }, { allowInactiveOwner: isAdmin });
  }

  private async requireAnotherActiveShop(manager: EntityManager): Promise<void> {
    // Per-owner locks cannot protect a count shared by different owners.
    await manager.query("SELECT pg_advisory_xact_lock(hashtext('trucycle'), hashtext('shop-deactivation'))");
    const activeCount = await manager.getRepository(Shop).count({ where: { active: true } });
    if (activeCount <= 1) throw new BadRequestException('At least one shop must remain active');
  }

  // Coordinates in degrees, search membership/distance in metres.
  async findNearby(lon: number, lat: number, radiusMeters?: number) {
    if (!validLocationPoint(lat, lon)) throw new BadRequestException('Invalid coordinates');
    const radius = radiusMeters === undefined ? 5000 : radiusMeters;
    if (!Number.isFinite(radius) || radius <= 0 || radius > 50000) throw new BadRequestException('Search radius must be greater than zero and at most 50000 metres');
    const rows = await this.geo.nearestShops(lon, lat, radius);
    // rows include extra shop columns and distance in meters
    return rows.map((r: any) => {
      const distanceRaw = typeof r.distance_meters === 'number' ? r.distance_meters : NaN;
      const point = validLocationPoint(r.latitude, r.longitude);
      return {
        id: r.id,
        name: r.name,
        phone_number: r.phone_number ?? null,
        address_line: r.address_line,
        postcode: normalizeFullUkPostcode(r.postcode),
        operational_notes: null,
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        opening_hours: r.opening_hours ?? null,
        acceptable_categories: Array.isArray(r.acceptable_categories) ? r.acceptable_categories : [],
        // keep existing field name for backward compatibility
        distanceMeters: Number.isFinite(distanceRaw) && distanceRaw >= 0 ? Math.round(distanceRaw) : null,
      };
    });
  }

  // Convenience: geocode postcode/address and reuse coordinate search
  async findNearbyByPostcode(postcode: string, radiusMeters?: number) {
    if (radiusMeters !== undefined && (!Number.isFinite(radiusMeters) || radiusMeters <= 0 || radiusMeters > 50000)) {
      throw new BadRequestException('Search radius must be greater than zero and at most 50000 metres');
    }
    const trimmed = (postcode ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('postcode is required');
    }
    const loc = await this.geocoding.forwardGeocode(trimmed);
    return this.findNearby(loc.longitude, loc.latitude, radiusMeters);
  }

  private view(s: Shop, isOwner = false) {
    const phoneNumber = typeof s.phoneNumber === 'string' && s.phoneNumber.trim() ? s.phoneNumber.trim() : null;
    const operationalNotes = typeof s.operationalNotes === 'string' && s.operationalNotes.trim() ? s.operationalNotes.trim() : null;
    const point = validLocationPoint(s.latitude, s.longitude);
    const latitude = point?.latitude ?? null;
    const longitude = point?.longitude ?? null;
    const openingHours = s.openingHours ? { ...s.openingHours } : null;
    const acceptableCategories = Array.isArray(s.acceptableCategories) ? [...s.acceptableCategories] : [];

    return {
      id: s.id,
      name: s.name,
      phone_number: phoneNumber,
      address_line: s.addressLine,
      postcode: isOwner ? s.postcode : normalizeFullUkPostcode(s.postcode),
      operational_notes: isOwner ? operationalNotes : null,
      latitude,
      longitude,
      opening_hours: openingHours,
      acceptable_categories: acceptableCategories,
      active: !!s.active,
      created_at: this.formatDate(s.createdAt),
      updated_at: this.formatDate(s.updatedAt),
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
      const dropoffLocation = this.view(shop, true);
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
                    name: [claim.collector.firstName, claim.collector.lastName].filter(Boolean).join(' ').trim() || 'Community member',
                    profile_image: claim.collector.profileImageUrl ?? null,
                  }
                : null,
            }
          : null,
        dropoff_location: dropoffLocation,
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
    await this.ensurePartnerActor(user);

    const myShops = await this.shops.find({ where: { owner: { id: user.id } } });
    if (!myShops.length) {
      return { items: [], pagination: { page: 1, limit: dto?.limit ?? 10, total: 0, total_pages: 0 } };
    }
    const shopIds = myShops.map((s) => s.id);
    const shopEntityMap = new Map(myShops.map((shop) => [shop.id, shop]));

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
      const dropoffEntity = shopEntityMap.get(item.dropoffLocationId ?? '');
      const dropoffLocation = dropoffEntity ? this.view(dropoffEntity, true) : null;
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
                    name: [claim.collector.firstName, claim.collector.lastName].filter(Boolean).join(' ').trim() || 'Community member',
                    profile_image: claim.collector.profileImageUrl ?? null,
                  }
                : null,
            }
          : null,
        dropoff_location: dropoffLocation,
      };
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      items,
      pagination: { page, limit, total, total_pages: totalPages },
    };
  }
}
