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

import { Claim, ClaimStatus } from '../claims/claim.entity';
import { Item, ItemPickupOption, ItemStatus } from '../items/item.entity';
import { RoleCode } from '../users/role.entity';
import { userHasAnyRole, userHasRole } from '../users/role.utils';
import { User, UserStatus } from '../users/user.entity';

import { sanitizeShopId } from './qr.utils';
import { ScanType, fetchScanEvents, recordScanEvent } from './scan-events.util';
import { NearbyItemsAlertService } from '../notifications/nearby-items-alert.service';
interface ActiveActorContext {
  user: User;
  isAdmin: boolean;
}

@Injectable()
export class QrService {
  private readonly qrBaseUrl = (process.env.ITEM_QR_BASE_URL || 'https://cdn.trucycle.com/qrs').replace(/\/$/, '');

  constructor(
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Claim) private readonly claims: Repository<Claim>,
    private readonly nearbyAlerts: NearbyItemsAlertService,
  ) {}

  private resolveQrCode(item: Item): string {
    if (typeof item.qrCodeUrl === 'string' && item.qrCodeUrl.trim()) {
      return item.qrCodeUrl.trim();
    }
    return `${this.qrBaseUrl}/item-${item.id}.png`;
  }

  private async resolveActor(authPayload: any): Promise<ActiveActorContext> {
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
      throw new ForbiddenException('Inactive users cannot perform QR actions');
    }
    const isAdmin = userHasRole(authPayload, RoleCode.ADMIN);
    return { user, isAdmin };
  }

  private ensureFacilityActor(payload: any) {
    if (userHasRole(payload, RoleCode.ADMIN)) {
      return;
    }
    // Allow partners as well as facility staff
    if (!userHasAnyRole(payload, [RoleCode.FACILITY, RoleCode.PARTNER])) {
      throw new ForbiddenException('Facility or partner staff only');
    }
  }

  private ensureLogisticsActor(payload: any) {
    if (userHasRole(payload, RoleCode.ADMIN)) {
      return;
    }
    if (!userHasAnyRole(payload, [RoleCode.PARTNER, RoleCode.FACILITY])) {
      throw new ForbiddenException('Logistics staff only');
    }
  }

  async viewItem(authPayload: any, rawItemId: string) {
    await this.resolveActor(authPayload);

    const itemId = typeof rawItemId === 'string' ? rawItemId.trim() : '';
    if (!itemId) {
      throw new BadRequestException('Item id is required');
    }

    const now = new Date();

    return this.items.manager.transaction(async (manager) => {
      const itemRepo = manager.getRepository(Item);
      const claimRepo = manager.getRepository(Claim);

      const item = await itemRepo.findOne({ where: { id: itemId } });
      if (!item) {
        throw new NotFoundException('Item not found');
      }

      const claim = await claimRepo.findOne({
        where: {
          item: { id: item.id },
          status: In([ClaimStatus.PENDING_APPROVAL, ClaimStatus.APPROVED, ClaimStatus.COMPLETE]),
        },
        order: { createdAt: 'DESC' },
        relations: { collector: true },
      });

      await recordScanEvent(manager, item.id, ScanType.ITEM_VIEW, null, now);
      const scanEvents = await fetchScanEvents(manager, item.id);

      return {
        id: item.id,
        status: item.status,
        pickup_option: item.pickupOption,
        qr_code: this.resolveQrCode(item),
        claim: claim
          ? {
              id: claim.id,
              status: claim.status,
              collector_id: claim.collector?.id ?? null,
            }
          : null,
        scan_events: scanEvents,
      };
    });
  }

  async registerDropoff(
    authPayload: any,
    rawItemId: string,
    rawShopId: string,
    rawAction?: string,
    rawReason?: string,
  ) {
    await this.resolveActor(authPayload);
    this.ensureFacilityActor(authPayload);

    const itemId = typeof rawItemId === 'string' ? rawItemId.trim() : '';
    if (!itemId) {
      throw new BadRequestException('Item id is required');
    }

    const shopId = sanitizeShopId(rawShopId);
    if (!shopId) {
      throw new BadRequestException('shop_id is required');
    }

    const action =
      typeof rawAction === 'string' && rawAction.trim() ? rawAction.trim().toLowerCase() : 'accept';
    if (action !== 'accept' && action !== 'reject') {
      throw new BadRequestException('Invalid action requested');
    }

    let rejectionReason: string | null = null;
    if (action === 'reject') {
      const trimmedReason =
        typeof rawReason === 'string' && rawReason.trim() ? rawReason.trim().slice(0, 240) : '';
      if (!trimmedReason) {
        throw new BadRequestException('Rejection reason is required');
      }
      rejectionReason = trimmedReason;
    }

    const scanDate = new Date();

    const result = await this.items.manager.transaction(async (manager) => {
      const itemRepo = manager.getRepository(Item);

      const item = await itemRepo
        .createQueryBuilder('item')
        .setLock('pessimistic_write')
        .where('item.id = :itemId', { itemId })
        .getOne();

      if (!item) {
        throw new NotFoundException('Item not found');
      }

      const expectedShopId =
        typeof item.dropoffLocationId === 'string'
          ? sanitizeShopId(item.dropoffLocationId)
          : '';
      if (!expectedShopId) {
        throw new ConflictException('Item is not assigned to a drop-off location');
      }
      if (expectedShopId.toLowerCase() !== shopId.toLowerCase()) {
        throw new ForbiddenException('Drop-off location mismatch');
      }

      if (item.status === ItemStatus.COMPLETE || item.status === ItemStatus.RECYCLED) {
        throw new ConflictException('Item has already completed its lifecycle');
      }

      if (
        item.status !== ItemStatus.PENDING_DROPOFF &&
        item.status !== ItemStatus.AWAITING_COLLECTION
      ) {
        throw new ConflictException('Item is not pending a donor drop-off');
      }

      if (action === 'accept') {
        if (item.status === ItemStatus.PENDING_DROPOFF) {
          item.status = ItemStatus.AWAITING_COLLECTION;
          await itemRepo.save(item);
        }
      } else {
        item.status = ItemStatus.REJECTED;
        await itemRepo.save(item);
      }

      await recordScanEvent(manager, item.id, ScanType.DROP_OFF_IN, shopId, scanDate);
      const scanEvents = await fetchScanEvents(manager, item.id);

      const response: Record<string, unknown> = {
        scan_result: action === 'reject' ? 'rejected' : 'accepted',
        scan_type: ScanType.DROP_OFF_IN,
        item_status: item.status,
        scanned_at: scanDate.toISOString(),
        scan_events: scanEvents,
      };
      if (rejectionReason) {
        response.rejection_reason = rejectionReason;
      }

      return { response, itemId: item.id, finalStatus: item.status, action } as any;
    });

    // Fire-and-forget email alerts if drop-off was accepted and item is available to collect.
    try {
      if (result?.action === 'accept' && (result?.finalStatus === ItemStatus.AWAITING_COLLECTION || result?.finalStatus === ItemStatus.ACTIVE)) {
        // Do not block response on email sending
        void this.nearbyAlerts.sendNearbyItemDropoffEmails(result.itemId);
      }
    } catch {}

    return result?.response ?? result;
  }

  async registerRecycleIn(authPayload: any, rawItemId: string, rawShopId: string) {
    await this.resolveActor(authPayload);
    this.ensureLogisticsActor(authPayload);

    const itemId = typeof rawItemId === 'string' ? rawItemId.trim() : '';
    if (!itemId) {
      throw new BadRequestException('Item id is required');
    }

    const shopId = sanitizeShopId(rawShopId);
    if (!shopId) {
      throw new BadRequestException('shop_id is required');
    }

    const scanDate = new Date();

    return this.items.manager.transaction(async (manager) => {
      const itemRepo = manager.getRepository(Item);

      const item = await itemRepo
        .createQueryBuilder('item')
        .setLock('pessimistic_write')
        .where('item.id = :itemId', { itemId })
        .getOne();

      if (!item) {
        throw new NotFoundException('Item not found');
      }
      if (item.pickupOption !== ItemPickupOption.RECYCLE) {
        throw new ConflictException('Item is not configured for the recycle workflow');
      }
      if (item.status === ItemStatus.RECYCLED) {
        throw new ConflictException('Item has already been recycled');
      }
      if (item.status === ItemStatus.PENDING_RECYCLE_PROCESSING) {
        await recordScanEvent(manager, item.id, ScanType.RECYCLE_IN, shopId, scanDate);
        const scanEvents = await fetchScanEvents(manager, item.id);
        return {
          id: item.id,
          status: item.status,
          recycle_in_at: scanDate.toISOString(),
          shop_id: shopId,
          scan_events: scanEvents,
        };
      }
      if (item.status !== ItemStatus.PENDING_RECYCLE) {
        throw new ConflictException('Item is not ready for recycle intake');
      }

      item.status = ItemStatus.PENDING_RECYCLE_PROCESSING;
      await itemRepo.save(item);

      await recordScanEvent(manager, item.id, ScanType.RECYCLE_IN, shopId, scanDate);
      const scanEvents = await fetchScanEvents(manager, item.id);

      return {
        id: item.id,
        status: item.status,
        recycle_in_at: scanDate.toISOString(),
        shop_id: shopId,
        scan_events: scanEvents,
      };
    });
  }

  async registerRecycleOut(authPayload: any, rawItemId: string, rawShopId: string) {
    await this.resolveActor(authPayload);
    this.ensureLogisticsActor(authPayload);

    const itemId = typeof rawItemId === 'string' ? rawItemId.trim() : '';
    if (!itemId) {
      throw new BadRequestException('Item id is required');
    }

    const shopId = sanitizeShopId(rawShopId);
    if (!shopId) {
      throw new BadRequestException('shop_id is required');
    }

    const scanDate = new Date();

    return this.items.manager.transaction(async (manager) => {
      const itemRepo = manager.getRepository(Item);

      const item = await itemRepo
        .createQueryBuilder('item')
        .setLock('pessimistic_write')
        .where('item.id = :itemId', { itemId })
        .getOne();

      if (!item) {
        throw new NotFoundException('Item not found');
      }
      if (item.pickupOption !== ItemPickupOption.RECYCLE) {
        throw new ConflictException('Item is not configured for the recycle workflow');
      }
      if (item.status === ItemStatus.RECYCLED) {
        await recordScanEvent(manager, item.id, ScanType.RECYCLE_OUT, shopId, scanDate);
        const scanEvents = await fetchScanEvents(manager, item.id);
        return {
          id: item.id,
          status: item.status,
          recycle_out_at: scanDate.toISOString(),
          shop_id: shopId,
          scan_events: scanEvents,
        };
      }
      if (item.status !== ItemStatus.PENDING_RECYCLE_PROCESSING) {
        throw new ConflictException('Item is not awaiting recycle completion');
      }

      item.status = ItemStatus.RECYCLED;
      await itemRepo.save(item);

      await recordScanEvent(manager, item.id, ScanType.RECYCLE_OUT, shopId, scanDate);
      const scanEvents = await fetchScanEvents(manager, item.id);

      return {
        id: item.id,
        status: item.status,
        recycle_out_at: scanDate.toISOString(),
        shop_id: shopId,
        scan_events: scanEvents,
      };
    });
  }
}
