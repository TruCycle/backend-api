import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { EntityManager, In, Repository } from 'typeorm';

import { safeFailure } from '../../common/utils/safe-log';
import { User } from '../users/user.entity';

import { nearbyItemProjection, NEARBY_ITEM_SOURCE } from './nearby-item-projection';
import { Notification, NotificationViewModel } from './notification.entity';
import { NotificationsGateway } from './notifications.gateway';

export type NotificationType =
  | 'item.nearby'
  | 'item.claim.request'
  | 'item.claim.approved'
  | 'item.collection'
  | 'dropin.created'
  | 'dropoff.created'
  | 'pickup.created'
  | 'general';

@Injectable()
export class NotificationsService {

  /**
   * Notify a user about a new item listed for exchange or donation within 10km
   */
  async notifyNearbyItem(userId: string, itemId: string, itemTitle?: string, itemPostcode?: string) {
    const projected = nearbyItemProjection(itemId, itemTitle, itemPostcode);
    await this.createAndEmit(
      userId,
      'item.nearby', projected.title, projected.body, projected.data,
    );
  }
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Optional()
    @Inject(forwardRef(() => NotificationsGateway))
    private readonly gateway?: NotificationsGateway,
  ) { }

  private normalizeUserId(userId: string): string {
    const trimmed = typeof userId === 'string' ? userId.trim() : '';
    if (!trimmed) {
      throw new BadRequestException('User id is required');
    }
    return trimmed;
  }

  async listForUser(userId: string, opts?: { unread?: boolean; limit?: number }): Promise<NotificationViewModel[]> {
    const normalizedUserId = this.normalizeUserId(userId);
    const take = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
    const qb = this.notifications.createQueryBuilder('notification')
      .leftJoinAndSelect('notification.user', 'user')
      .where('user.id = :userId', { userId: normalizedUserId });
    if (opts?.unread === true) {
      qb.andWhere('notification.read = false');
    }
    qb.orderBy('notification.createdAt', 'DESC').take(take);
    const rows = await qb.getMany();
    this.logger.log({ operation: 'notifications_list', count: rows.length });
    return rows.map((n) => this.view(n));
  }

  async countUnread(userId: string): Promise<number> {
    const normalizedUserId = this.normalizeUserId(userId);
    return this.notifications.count({ where: { user: { id: normalizedUserId }, read: false } });
  }

  async createAndEmit(
    userId: string,
    type: NotificationType,
    title: string,
    body?: string | null,
    data?: Record<string, any> | null,
  ): Promise<NotificationViewModel> {
    const normalizedUserId = this.normalizeUserId(userId);
    const user = await this.users.findOne({ where: { id: normalizedUserId } });
    if (!user) throw new BadRequestException('User not found');
    const view = await this.persist(this.notifications, user, type, title, body, data);
    await this.emitPersisted(normalizedUserId, view);
    return view;
  }

  async createInTransaction(manager: EntityManager, userId: string, type: NotificationType, title: string,
    body: string, data: Record<string, unknown>): Promise<NotificationViewModel> {
    return this.persist(manager.getRepository(Notification), { id: this.normalizeUserId(userId) }, type, title, body, data);
  }

  private async persist(repository: Repository<Notification>, user: Pick<User, 'id'>, type: NotificationType, title: string,
    body?: string | null, data?: Record<string, unknown> | null): Promise<NotificationViewModel> {
    const row = repository.create({ user, type, title, body: body ?? null, data: data ?? null, read: false });
    return this.view(await repository.save(row));
  }

  async emitPersisted(userId: string, view: NotificationViewModel): Promise<void> {
    try {
      await this.gateway?.emitToUser(userId, view);
    } catch (err) {
      this.logger.warn(safeFailure('notification_emit', err));
    }
  }

  async markRead(userId: string, ids: string[]): Promise<number> {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!Array.isArray(ids) || ids.length > 100 ||
        ids.some(id => typeof id !== 'string' || !isUUID(id.trim(), 'all'))) {
      throw new BadRequestException('Provide at most 100 valid notification IDs');
    }
    const unique = Array.from(new Set(ids.map(id => id.trim().toLowerCase())));
    if (unique.length === 0) return 0;
    const now = new Date();
    const res = await this.notifications.update({ id: In(unique), user: { id: normalizedUserId }, read: false }, {
      read: true,
      readAt: now,
    } as any);
    const updated = res.affected || 0;
    if (updated) await this.emitReadChanged(normalizedUserId);
    return updated;
  }

  async markAllRead(userId: string): Promise<number> {
    const normalizedUserId = this.normalizeUserId(userId);
    const result = await this.notifications.update({
      user: { id: normalizedUserId },
      read: false,
    }, { read: true, readAt: new Date() });
    const updated = result.affected ?? 0;
    if (updated) await this.emitReadChanged(normalizedUserId);
    return updated;
  }

  private async emitReadChanged(userId: string): Promise<void> {
    try {
      await this.gateway?.emitReadChanged(userId);
    } catch (error) {
      this.logger.warn(safeFailure('notification_read_delivery', error));
    }
  }

  // Domain helpers — call from Items/Claims flows
  async notifyItemClaimRequested(donorUserId: string, collectorUserId: string, itemId: string, itemTitle?: string) {
    if (donorUserId !== collectorUserId) {
      await this.createAndEmit(
        donorUserId,
        'item.claim.request',
        'New claim request',
        itemTitle ? `Your item “${itemTitle}” has a new claim request.` : 'Your item has a new claim request.',
        { itemId },
      );
      await this.createAndEmit(
        collectorUserId,
        'item.claim.request',
        'Claim request sent',
        itemTitle ? `You requested to claim “${itemTitle}”.` : 'You submitted a new claim request.',
        { itemId },
      );
    } else {
      // Only send one notification if donor and collector are the same
      await this.createAndEmit(
        donorUserId,
        'item.claim.request',
        'Claim request sent',
        itemTitle ? `You requested to claim “${itemTitle}”.` : 'You submitted a new claim request.',
        { itemId },
      );
    }
  }

  async notifyItemClaimApproved(collectorUserId: string, itemId: string, itemTitle?: string) {
    await this.createAndEmit(
      collectorUserId,
      'item.claim.approved',
      'Claim approved',
      itemTitle ? `Your claim for “${itemTitle}” was approved.` : 'Your claim was approved.',
      { itemId },
    );
  }

  async notifyItemCollected(donorUserId: string, collectorUserId: string, itemId: string, itemTitle?: string) {
    if (donorUserId !== collectorUserId) {
      await this.createAndEmit(
        donorUserId,
        'item.collection',
        'Item collected',
        itemTitle ? `“${itemTitle}” was collected.` : 'Your item was collected.',
        { itemId },
      );
      await this.createAndEmit(
        collectorUserId,
        'item.collection',
        'Collection recorded',
        itemTitle ? `You collected “${itemTitle}”.` : 'Collection recorded.',
        { itemId },
      );
    } else {
      // Only send one notification if donor and collector are the same
      await this.createAndEmit(
        donorUserId,
        'item.collection',
        'Collection recorded',
        itemTitle ? `You collected “${itemTitle}”.` : 'Collection recorded.',
        { itemId },
      );
    }
  }

  async notifyDropIn(shopOwnerUserId: string, donorUserId: string, itemId: string, itemTitle?: string) {
    if (shopOwnerUserId !== donorUserId) {
      await this.createAndEmit(
        shopOwnerUserId,
        'dropin.created',
        'New drop-in registered',
        itemTitle ? `Drop-in created for “${itemTitle}”.` : 'A new drop-in was created.',
        { itemId },
      );
      await this.createAndEmit(
        donorUserId,
        'dropin.created',
        'Drop-in created',
        itemTitle ? `You created a drop-in for “${itemTitle}”.` : 'You created a drop-in.',
        { itemId },
      );
    } else {
      // Only send one notification if shop owner and donor are the same
      await this.createAndEmit(
        donorUserId,
        'dropin.created',
        'Drop-in created',
        itemTitle ? `You created a drop-in for “${itemTitle}”.` : 'You created a drop-in.',
        { itemId },
      );
    }
  }

  async notifyDropOff(userId: string, itemId: string, itemTitle?: string) {
    await this.createAndEmit(
      userId,
      'dropoff.created',
      'Drop-off recorded',
      itemTitle ? `Drop-off recorded for “${itemTitle}”.` : 'Drop-off recorded.',
      { itemId },
    );
  }

  async notifyPickup(userId: string, itemId: string, itemTitle?: string) {
    await this.createAndEmit(
      userId,
      'pickup.created',
      'Pickup scheduled',
      itemTitle ? `Pickup scheduled for “${itemTitle}”.` : 'Pickup scheduled.',
      { itemId },
    );
  }

  view(n: Notification): NotificationViewModel {
    // The server-generated nearby type predates the source marker. Rebuild
    // legacy messages without returning their stored text or arbitrary metadata.
    const nearby = n.type === 'item.nearby'
      ? nearbyItemProjection(n.data?.itemId, n.data?.source === NEARBY_ITEM_SOURCE ? n.data?.itemTitle : null,
        n.data?.itemPostcode)
      : null;
    return {
      id: n.id,
      userId: n.user?.id ?? null,
      type: n.type,
      title: nearby?.title ?? n.title,
      body: nearby?.body ?? n.body ?? null,
      data: nearby ? nearby.data : n.data ?? null,
      read: n.read,
      readAt: n.readAt ?? null,
      createdAt: n.createdAt,
    };
  }
}
