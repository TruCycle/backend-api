import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Item, ItemPickupOption, ItemStatus } from './item.entity';
import { CreateItemDto } from './dto/create-item.dto';
import { User, UserStatus } from '../users/user.entity';
import { ServiceZone } from '../addresses/service-zone.entity';
import { ItemGeocodingService } from './item-geocoding.service';
import { ItemLocation } from './item-location.interface';

@Injectable()
export class ItemsService {
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
    if (!input || typeof input !== 'object') return null;
    const safe: Record<string, string | number | boolean> = {};
    const entries = Object.entries(input).slice(0, 20);
    for (const [rawKey, rawValue] of entries) {
      if (typeof rawKey !== 'string') continue;
      const key = rawKey.trim().slice(0, 60);
      if (!key) continue;
      if (typeof rawValue === 'string') {
        safe[key] = rawValue.trim().slice(0, 240);
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
    const images: { url: string; altText: string | null }[] = [];
    const seenUrls = new Set<string>();
    for (const image of dto.images || []) {
      const url = image.url;
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      images.push({ url, altText: image.altText?.trim() || null });
    }

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
}
