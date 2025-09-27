import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Item, ItemStatus } from '../items/item.entity';
import { RoleCode } from '../users/role.entity';
import { User, UserStatus } from '../users/user.entity';

import { Claim, ClaimStatus } from './claim.entity';
import { CreateClaimDto } from './dto/create-claim.dto';

const CLAIMABLE_STATUSES: readonly ItemStatus[] = [ItemStatus.ACTIVE];
const ACTIVE_CLAIM_STATUSES: readonly ClaimStatus[] = [
  ClaimStatus.PENDING_APPROVAL,
  ClaimStatus.APPROVED,
];

@Injectable()
export class ClaimsService {
  constructor(
    @InjectRepository(Claim) private readonly claims: Repository<Claim>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private ensureCollectorRole(payload: any) {
    const roles: string[] = Array.isArray(payload?.roles)
      ? payload.roles.map((role: any) => String(role).toLowerCase())
      : [];
    if (roles.includes(RoleCode.ADMIN)) {
      return;
    }
    if (!roles.includes(RoleCode.COLLECTOR)) {
      throw new ForbiddenException('Collectors only');
    }
  }

  private ensureAdminRole(payload: any) {
    const roles: string[] = Array.isArray(payload?.roles)
      ? payload.roles.map((role: any) => String(role).toLowerCase())
      : [];
    if (!roles.includes(RoleCode.ADMIN)) {
      throw new ForbiddenException('Admins only');
    }
  }

  async createClaim(authPayload: any, dto: CreateClaimDto) {
    if (!authPayload || typeof authPayload.sub !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    this.ensureCollectorRole(authPayload);

    const collector = await this.users.findOne({ where: { id: authPayload.sub } });
    if (!collector) {
      throw new UnauthorizedException('User record not found');
    }
    if (collector.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Inactive users cannot create claims');
    }

    const item = await this.items.findOne({ where: { id: dto.itemId }, relations: { donor: true } });
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    if (!CLAIMABLE_STATUSES.includes(item.status)) {
      throw new BadRequestException('Item is not available for claiming');
    }
    if (item.donor && item.donor.id === collector.id) {
      throw new ForbiddenException('You cannot claim an item you listed');
    }

    const activeClaim = await this.claims.findOne({
      where: {
        item: { id: item.id },
        status: In(ACTIVE_CLAIM_STATUSES),
      },
    });
    if (activeClaim) {
      throw new ConflictException('This item already has an active claim');
    }

    const entity = this.claims.create({
      item,
      collector,
      status: ClaimStatus.PENDING_APPROVAL,
    });
    const saved = await this.claims.save(entity);
    await this.items.update(item.id, { status: ItemStatus.CLAIMED });

    const createdAt =
      saved.createdAt instanceof Date && !Number.isNaN(saved.createdAt.getTime())
        ? saved.createdAt.toISOString()
        : new Date().toISOString();

    return {
      id: saved.id,
      item_id: saved.item.id,
      collector_id: saved.collector.id,
      status: saved.status,
      created_at: createdAt,
    };
  }

  async approveClaim(authPayload: any, rawId: string) {
    if (!authPayload || typeof authPayload.sub !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    this.ensureAdminRole(authPayload);

    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) {
      throw new BadRequestException('Claim id is required');
    }

    const claim = await this.claims.findOne({ where: { id } });
    if (!claim) {
      throw new NotFoundException('Claim not found');
    }
    if (claim.status !== ClaimStatus.PENDING_APPROVAL) {
      throw new ConflictException('Only pending claims can be approved');
    }

    claim.status = ClaimStatus.APPROVED;
    claim.approvedAt = new Date();

    const saved = await this.claims.save(claim);

    return {
      id: saved.id,
      status: saved.status,
      approved_at: saved.approvedAt?.toISOString() ?? new Date().toISOString(),
    };
  }
}
