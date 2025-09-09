import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Address } from './address.entity';
import { ServiceZone } from './service-zone.entity';
import { User } from '../users/user.entity';
import { CreateAddressDto } from './dto/create-address.dto';

@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(Address) private readonly addresses: Repository<Address>,
    @InjectRepository(ServiceZone) private readonly zones: Repository<ServiceZone>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async create(userId: string, dto: CreateAddressDto) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const inLondon = await this.zones
      .createQueryBuilder('z')
      .where('z.name = :name', { name: 'London' })
      .andWhere('z.active = true')
      .andWhere(
        `ST_Contains(z.geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))`,
        { lon: dto.longitude, lat: dto.latitude },
      )
      .getCount();

    if (inLondon === 0) {
      throw new BadRequestException('Address outside London service area');
    }

    const entity = this.addresses.create({
      user,
      label: dto.label,
      line1: dto.line1,
      line2: dto.line2,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      isDefault: dto.isDefault ?? false,
      geom: { type: 'Point', coordinates: [dto.longitude, dto.latitude] },
    });
    const saved = await this.addresses.save(entity);
    return {
      id: saved.id,
      label: saved.label,
      line1: saved.line1,
      line2: saved.line2,
      city: saved.city,
      state: saved.state,
      country: saved.country,
      isDefault: saved.isDefault,
      createdAt: saved.createdAt,
    };
  }
}

