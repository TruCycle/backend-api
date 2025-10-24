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
import { sanitizeShopId } from '../qr/qr.utils';
import { ScanType, fetchScanEvents, recordScanEvent } from '../qr/scan-events.util';
import { RoleCode } from '../users/role.entity';
import { userHasRole } from '../users/role.utils';
import { User, UserStatus } from '../users/user.entity';

import { Claim, ClaimStatus } from './claim.entity';
import { CreateClaimDto } from './dto/create-claim.dto';
const CLAIMABLE_STATUSES: readonly ItemStatus[] = [ItemStatus.ACTIVE, ItemStatus.AWAITING_COLLECTION];
// Allow multiple pending requests: only an already-approved claim should block
const ACTIVE_CLAIM_STATUSES: readonly ClaimStatus[] = [ClaimStatus.APPROVED];

@Injectable()
export class ClaimsService {
  constructor(
    @InjectRepository(Claim) private readonly claims: Repository<Claim>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private ensureCollectorRole(payload: any) {
    if (userHasRole(payload, RoleCode.ADMIN)) {
      return;
    }
    if (!userHasRole(payload, RoleCode.COLLECTOR)) {
      throw new ForbiddenException('Collectors only');
    }
  }

  private ensureAdminRole(payload: any) {
    if (!userHasRole(payload, RoleCode.ADMIN)) {
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

    // Ensure this collector has not already created a claim for this item
    const existingForCollector = await this.claims.findOne({
      where: {
        item: { id: item.id },
        collector: { id: collector.id },
      },
    });
    if (existingForCollector) {
      throw new ConflictException('You have already claimed this item');
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
    const approverId = authPayload.sub;
    const isAdmin = userHasRole(authPayload, RoleCode.ADMIN);

    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) {
      throw new BadRequestException('Claim id is required');
    }

    const claim = await this.claims.findOne({ where: { id }, relations: { item: { donor: true } } });
    if (!claim) {
      throw new NotFoundException('Claim not found');
    }
    if (claim.status !== ClaimStatus.PENDING_APPROVAL) {
      throw new ConflictException('Only pending claims can be approved');
    }
    // Only the item donor or an admin can approve
    const donorId = claim.item?.donor?.id;
    if (!isAdmin && (!donorId || donorId !== approverId)) {
      throw new ForbiddenException('Only the donor or an admin may approve this claim');
    }
    // Ensure item is active when approving the first claim
    if (claim.item && !CLAIMABLE_STATUSES.includes(claim.item.status)) {
      throw new ConflictException('Item is not active for approval');
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

  async completeClaimOut(authPayload: any, rawItemId: string, rawShopId: string) {
    if (!authPayload || typeof authPayload.sub !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }

    const isAdmin = userHasRole(authPayload, RoleCode.ADMIN);
    const isFacility = userHasRole(authPayload, RoleCode.FACILITY);
    const isPartner = userHasRole(authPayload, RoleCode.PARTNER);
    const isCollector = userHasRole(authPayload, RoleCode.COLLECTOR);

    if (!isAdmin && !isFacility && !isPartner && !isCollector) {
      throw new ForbiddenException('Collectors, facility, or partner staff only');
    }

    const actor = await this.users.findOne({ where: { id: authPayload.sub } });
    if (!actor) {
      throw new UnauthorizedException('User record not found');
    }
    if (actor.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Inactive users cannot complete claims');
    }

    const itemId = typeof rawItemId === 'string' ? rawItemId.trim() : '';
    if (!itemId) {
      throw new BadRequestException('Item id is required');
    }

    const shopId = sanitizeShopId(rawShopId);
    if (!shopId) {
      throw new BadRequestException('shop_id is required');
    }

    return this.claims.manager.transaction(async (manager) => {
      const claimRepo = manager.getRepository(Claim);
      const itemRepo = manager.getRepository(Item);

      const qb = claimRepo
        .createQueryBuilder('claim')
        // Lock only the base table to avoid Postgres outer-join FOR UPDATE error
        .setLock('pessimistic_write', undefined, ['claim'])
        .leftJoinAndSelect('claim.item', 'item')
        .leftJoinAndSelect('claim.collector', 'collector')
        .where('item.id = :itemId', { itemId });

      if (!isAdmin && !isFacility && !isPartner && isCollector) {
        qb.andWhere('collector.id = :actorId', { actorId: actor.id });
      }

      qb.orderBy(
        `CASE WHEN claim.status = :approved THEN 0 WHEN claim.status = :complete THEN 1 WHEN claim.status = :pending THEN 2 ELSE 3 END`,
        'ASC',
      ).addOrderBy('claim.created_at', 'DESC')
        .setParameters({
          approved: ClaimStatus.APPROVED,
          complete: ClaimStatus.COMPLETE,
          pending: ClaimStatus.PENDING_APPROVAL,
        });

      const claim = await qb.getOne();

      if (!claim) {
        throw new NotFoundException('Claim not found for item');
      }

      const expectedShopId =
        typeof claim.item?.dropoffLocationId === 'string'
          ? sanitizeShopId(claim.item.dropoffLocationId)
          : '';
      if (expectedShopId && expectedShopId.toLowerCase() !== shopId.toLowerCase()) {
        throw new ForbiddenException('Drop-off location mismatch');
      }

      if (!isAdmin && !isFacility && !isPartner) {
        if (!claim.collector || claim.collector.id !== actor.id) {
          throw new ForbiddenException('You are not allowed to complete this claim');
        }
      }

      if (claim.status === ClaimStatus.REJECTED || claim.status === ClaimStatus.CANCELLED) {
        throw new ConflictException('This claim can no longer be completed');
      }
      if (claim.status === ClaimStatus.PENDING_APPROVAL) {
        throw new ConflictException('Claim must be approved before completion');
      }

      if (claim.status === ClaimStatus.COMPLETE) {
        const completedAt =
          claim.completedAt instanceof Date && !Number.isNaN(claim.completedAt.getTime())
            ? claim.completedAt
            : new Date();
        if (completedAt !== claim.completedAt) {
          claim.completedAt = completedAt;
          await claimRepo.save(claim);
        }
        const events = await fetchScanEvents(manager, claim.item.id);
        return {
          id: claim.id,
          status: claim.status,
          scan_type: ScanType.CLAIM_OUT,
          scan_result: 'already_completed',
          completed_at: completedAt.toISOString(),
          scan_events: events,
        };
      }

      if (claim.status !== ClaimStatus.APPROVED) {
        throw new ConflictException('Claim is not eligible for completion');
      }

      const completionDate = new Date();
      claim.status = ClaimStatus.COMPLETE;
      claim.completedAt = completionDate;

      await claimRepo.save(claim);
      await itemRepo.update(claim.item.id, { status: ItemStatus.COMPLETE });
      await recordScanEvent(manager, claim.item.id, ScanType.CLAIM_OUT, shopId, completionDate);

      const events = await fetchScanEvents(manager, claim.item.id);

      return {
        id: claim.id,
        status: claim.status,
        scan_type: ScanType.CLAIM_OUT,
        scan_result: 'completed',
        completed_at: completionDate.toISOString(),
        scan_events: events,
      };
    });
  }

  // Manual completion without QR; allows donor or collector (and admin/facility/partner)
  async completeClaimOutManual(authPayload: any, rawItemId: string, rawShopId?: string) {
    if (!authPayload || typeof authPayload.sub !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }

    const isAdmin = userHasRole(authPayload, RoleCode.ADMIN);
    const isFacility = userHasRole(authPayload, RoleCode.FACILITY);
    const isPartner = userHasRole(authPayload, RoleCode.PARTNER);
    const isCollector = userHasRole(authPayload, RoleCode.COLLECTOR);

    const actor = await this.users.findOne({ where: { id: authPayload.sub } });
    if (!actor) {
      throw new UnauthorizedException('User record not found');
    }
    if (actor.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Inactive users cannot complete claims');
    }

    const itemId = typeof rawItemId === 'string' ? rawItemId.trim() : '';
    if (!itemId) {
      throw new BadRequestException('Item id is required');
    }

    const providedShopId = sanitizeShopId(rawShopId);

    return this.claims.manager.transaction(async (manager) => {
      const claimRepo = manager.getRepository(Claim);
      const itemRepo = manager.getRepository(Item);

      const qb = claimRepo
        .createQueryBuilder('claim')
        // Lock only the base table to avoid Postgres outer-join FOR UPDATE error
        .setLock('pessimistic_write', undefined, ['claim'])
        .leftJoinAndSelect('claim.item', 'item')
        .leftJoinAndSelect('item.donor', 'donor')
        .leftJoinAndSelect('claim.collector', 'collector')
        .where('item.id = :itemId', { itemId })
        .orderBy(
          `CASE WHEN claim.status = :approved THEN 0 WHEN claim.status = :complete THEN 1 WHEN claim.status = :pending THEN 2 ELSE 3 END`,
          'ASC',
        )
        .addOrderBy('claim.created_at', 'DESC')
        .setParameters({
          approved: ClaimStatus.APPROVED,
          complete: ClaimStatus.COMPLETE,
          pending: ClaimStatus.PENDING_APPROVAL,
        });

      // Do not restrict by collector here: donors (who carry the 'customer' alias that maps to 'collector')
      // must be able to complete as the item owner. Authorization is enforced after fetching the claim.

      const claim = await qb.getOne();
      if (!claim) {
        throw new NotFoundException('Claim not found for item');
      }

      const donorId = claim.item?.donor?.id;

      if (!isAdmin && !isFacility && !isPartner) {
        const asCollector = !!(claim.collector && claim.collector.id === actor.id);
        const asDonor = !!(donorId && donorId === actor.id);
        if (!asCollector && !asDonor) {
          throw new ForbiddenException('Only the donor or assigned collector may complete this claim');
        }
      }

      // If donation flow has a drop-off location, require a matching shop id
      const expectedShopId =
        typeof claim.item?.dropoffLocationId === 'string' ? sanitizeShopId(claim.item.dropoffLocationId) : '';
      if (expectedShopId) {
        if (!providedShopId) {
          throw new BadRequestException('shop_id is required for donation drop-offs');
        }
        if (expectedShopId.toLowerCase() !== providedShopId.toLowerCase()) {
          throw new ForbiddenException('Drop-off location mismatch');
        }
      }

      if (claim.status === ClaimStatus.REJECTED || claim.status === ClaimStatus.CANCELLED) {
        throw new ConflictException('This claim can no longer be completed');
      }
      if (claim.status === ClaimStatus.PENDING_APPROVAL) {
        throw new ConflictException('Claim must be approved before completion');
      }

      if (claim.status === ClaimStatus.COMPLETE) {
        const completedAt =
          claim.completedAt instanceof Date && !Number.isNaN(claim.completedAt.getTime()) ? claim.completedAt : new Date();
        if (completedAt !== claim.completedAt) {
          claim.completedAt = completedAt;
          await claimRepo.save(claim);
        }
        const events = await fetchScanEvents(manager, claim.item.id);
        return {
          id: claim.id,
          status: claim.status,
          scan_type: ScanType.CLAIM_OUT,
          scan_result: 'already_completed',
          completed_at: completedAt.toISOString(),
          scan_events: events,
        };
      }

      if (claim.status !== ClaimStatus.APPROVED) {
        throw new ConflictException('Claim is not eligible for completion');
      }

      const completionDate = new Date();
      claim.status = ClaimStatus.COMPLETE;
      claim.completedAt = completionDate;

      await claimRepo.save(claim);
      await itemRepo.update(claim.item.id, { status: ItemStatus.COMPLETE });
      await recordScanEvent(manager, claim.item.id, ScanType.CLAIM_OUT, providedShopId || null, completionDate);

      const events = await fetchScanEvents(manager, claim.item.id);
      return {
        id: claim.id,
        status: claim.status,
        scan_type: ScanType.CLAIM_OUT,
        scan_result: 'completed',
        completed_at: completionDate.toISOString(),
        scan_events: events,
      };
    });
  }
}
