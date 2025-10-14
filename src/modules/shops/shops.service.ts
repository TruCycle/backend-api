import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { GeoService } from '../../geo/geo.service';
import { RoleCode } from '../users/role.entity';
import { userHasRole } from '../users/role.utils';
import { User, UserStatus } from '../users/user.entity';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { Shop } from './shop.entity';

@Injectable()
export class ShopsService {
  constructor(
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly geo: GeoService,
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
}
