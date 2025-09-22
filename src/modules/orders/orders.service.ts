import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PickupOrder, PickupOrderStatus } from './pickup-order.entity';
import { PickupItem } from './pickup-item.entity';
import { Address } from '../addresses/address.entity';
import { User } from '../users/user.entity';
import { ServiceZone } from '../addresses/service-zone.entity';
import { CreatePickupOrderDto } from './dto/create-order.dto';
import { SearchOrdersDto } from './dto/search-orders.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(PickupOrder) private readonly orders: Repository<PickupOrder>,
    @InjectRepository(PickupItem) private readonly items: Repository<PickupItem>,
    @InjectRepository(Address) private readonly addresses: Repository<Address>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ServiceZone) private readonly zones: Repository<ServiceZone>,
  ) {}

  private toTitle(s?: string): string | undefined {
    if (!s) return undefined;
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  async create(userId: string, dto: CreatePickupOrderDto) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Ensure the address belongs to the user
    const address = await this.addresses.findOne({ where: { id: dto.origin_address_id, user: { id: userId } } });
    if (!address) throw new NotFoundException('Address not found');

    // Resolve service zone containing address point (subquery uses address geom directly)
    const zone = await this.zones
      .createQueryBuilder('z')
      .where('z.active = true')
      .andWhere('ST_Contains(z.geom, (SELECT geom FROM address WHERE id = :addrId))', {
        addrId: address.id,
      })
      .getOne();

    if (!zone) {
      throw new BadRequestException('Origin address is outside service area');
    }

    const now = new Date();

    // Create order
    const order = this.orders.create({
      customer: user,
      originAddress: address,
      zone,
      status: PickupOrderStatus.PLACED,
      placedAt: now,
      notes: dto.notes?.trim(),
      geom: address.geom, // copy for immutability
    });

    // Normalize and attach items
    order.items = dto.items.map((it) =>
      this.items.create({
        order,
        materialCode: it.material_id,
        quantity: String(it.qty),
        unit: 'pcs',
        weee: {
          ...(it.weee_data || {}),
          category: it.category,
          status: it.status,
          photos: it.photos || [],
        },
      }),
    );

    const saved = await this.orders.save(order);

    return {
      id: saved.id,
      status: 'requested', // external nomenclature
      placed_at: saved.placedAt ? saved.placedAt.toISOString() : now.toISOString(),
      items: (saved.items || []).map((it, idx) => {
        const src = dto.items[idx];
        const declared = this.toTitle(src?.status || '');
        return {
          id: it.id,
          declared_grade: declared || undefined,
          photos: src?.photos || [],
        };
      }),
    };
  }

  async search(dto: SearchOrdersDto) {
    const { lat, lon } = dto;
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      throw new BadRequestException('lat and lon are required numbers');
    }
    const unit = dto.unit || 'km';
    const distKm = dto.distance ?? 10;
    const distanceMeters = Math.max(0, distKm) * (unit === 'mi' ? 1609.344 : 1000);

    const pointExpr = 'ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)';
    const geographyPoint = `${pointExpr}::geography`;

    const qb = this.orders
      .createQueryBuilder('o')
      .innerJoin('o.customer', 'u')
      .select([
        'o.id as id',
        'u.firstName as firstName',
        'u.lastName as lastName',
        'ST_Y(o.geom) as lat',
        'ST_X(o.geom) as lon',
        `ST_Distance(o.geom::geography, ${geographyPoint}) as distance`,
        `(
          SELECT it.weee->>'make'
            FROM pickup_item it
           WHERE it.order_id = o.id
           ORDER BY it.created_at ASC NULLS LAST
           LIMIT 1
        ) as make`,
        `(
          SELECT it.weee->>'model'
            FROM pickup_item it
           WHERE it.order_id = o.id
           ORDER BY it.created_at ASC NULLS LAST
           LIMIT 1
        ) as model`,
        `(
          SELECT it.material_code
            FROM pickup_item it
           WHERE it.order_id = o.id
           ORDER BY it.created_at ASC NULLS LAST
           LIMIT 1
        ) as material_code`,
      ])
      .where('o.status IN (:...statuses)', { statuses: ['placed', 'scheduled'] })
      .andWhere(`ST_DWithin(o.geom::geography, ${geographyPoint}, :dist)`, {
        lon,
        lat,
        dist: distanceMeters,
      })
      .orderBy('distance', 'ASC')
      .limit(100);

    if (dto.category && dto.category.trim()) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM pickup_item i WHERE i.order_id = o.id AND (i.weee->>'category') ILIKE :cat)`,
        { cat: `${dto.category.trim()}%` },
      );
    }

    const rows = await qb.getRawMany();

    const results = rows.map((r: any) => {
      const username = [r.firstname, r.lastname ? `${r.lastname.charAt(0)}.` : '']
        .filter(Boolean)
        .join(' ')
        .trim();
      const itemsSummary = r.make && r.model ? `${r.make} ${r.model}` : r.material_code || 'Item';
      // Coarsen location to reduce precision (privacy)
      const coarse = (n: number) => Math.round(n * 100) / 100; // ~1.1km
      return {
        id: r.id,
        donor: {
          username: username || 'Donor',
          rating: null as number | null, // rating system not implemented yet
        },
        items_summary: itemsSummary,
        location: { lat: coarse(Number(r.lat)), lon: coarse(Number(r.lon)) },
        distance_meters: Math.round(Number(r.distance)),
      };
    });

    return results;
  }
}
