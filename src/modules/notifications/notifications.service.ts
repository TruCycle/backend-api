import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Notification, NotificationViewModel } from './notification.entity';
import { User } from '../users/user.entity';
import { NotificationsGateway } from './notifications.gateway';

export type NotificationType =
  | 'item.claim.request'
  | 'item.claim.approved'
  | 'item.collection'
  | 'dropin.created'
  | 'dropoff.created'
  | 'pickup.created'
  | 'general';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Optional()
    @Inject(forwardRef(() => NotificationsGateway))
    private readonly gateway?: NotificationsGateway,
  ) { }

  async listForUser(userId: string, opts?: { unread?: boolean; limit?: number }): Promise<NotificationViewModel[]> {
    const take = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
    const where: any = { user: { id: userId } };
    if (opts?.unread === true) where.read = false;
    const rows = await this.notifications.find({ where, order: { createdAt: 'DESC' }, take });
    this.logger.log(`Notification listing for userId=${userId}, count=${rows.length}`);
    rows.forEach((n) => {
      this.logger.log(`Notification for userId=${n.user?.id || '[unknown]'}: id=${n.id}, type=${n.type}, title=${n.title}`);
    });
    return rows.map((n) => this.view(n));
  }

  async countUnread(userId: string): Promise<number> {
    return this.notifications.count({ where: { user: { id: userId }, read: false } });
  }

  async createAndEmit(
    userId: string,
    type: NotificationType,
    title: string,
    body?: string | null,
    data?: Record<string, any> | null,
  ): Promise<NotificationViewModel> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    let n = this.notifications.create({ user, type, title, body: body ?? null, data: data ?? null, read: false });
    n = await this.notifications.save(n);
    const view = this.view(n);
    try {
      this.gateway?.emitToUser(userId, view);
    } catch (err) {
      this.logger.warn(`Failed to emit notification to user ${userId}: ${err}`);
    }
    return view;
  }

  async markRead(userId: string, ids: string[]): Promise<number> {
    const unique = Array.from(new Set((ids || []).filter((v) => typeof v === 'string' && v.trim())));
    if (unique.length === 0) return 0;
    const now = new Date();
    const res = await this.notifications.update({ id: In(unique), user: { id: userId }, read: false }, {
      read: true,
      readAt: now,
    } as any);
    return res.affected || 0;
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
    return {
      id: n.id,
      userId: n.user?.id ?? null,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      data: n.data ?? null,
      read: n.read,
      readAt: n.readAt ?? null,
      createdAt: n.createdAt,
    };
  }
}
