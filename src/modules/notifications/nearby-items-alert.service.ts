import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { resolveOutwardPostcode } from '../../common/utils/postcode';
import { publicLocationPoint } from '../../common/utils/public-location';
import { safeFailure } from '../../common/utils/safe-log';
import { frontendOrigin } from '../../common/utils/frontend-origin';
import { Item, ItemPickupOption, ItemStatus } from '../items/item.entity';
import { Shop } from '../shops/shop.entity';

import { EmailService } from './email.service';

@Injectable()
export class NearbyItemsAlertService {
  private readonly logger = new Logger(NearbyItemsAlertService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    private readonly email: EmailService,
  ) { }

  private getRadiusMeters(): number {
    const envKm = Number(process.env.NEARBY_ITEM_ALERT_RADIUS_KM || 20);
    const km = Number.isFinite(envKm) && envKm > 0 ? Math.min(envKm, 200) : 20;
    return Math.round(km * 1000);
  }

  private getMaxRecipients(): number {
    const raw = Number(process.env.NEARBY_ITEM_ALERT_MAX_RECIPIENTS || 200);
    return Math.min(Math.max(Number.isFinite(raw) ? Math.trunc(raw) : 0, 1), 1000);
  }
  /**   
   * Send bulk email alerts for newly listed drop-off donation items (when status is AWAITING_COLLECTION or ACTIVE)
   */


  async sendNearbyItemDropoffEmails(itemId: string): Promise<number> {
    try {
      const item = await this.items.findOne({ where: { id: itemId }, relations: { donor: true } });
      if (!item) return 0;

      if (item.pickupOption !== ItemPickupOption.DONATE) return 0;
      if (!item.dropoffLocationId) return 0;

      // Only alert after the drop-off is accepted and item is available to collect
      if (item.status !== ItemStatus.AWAITING_COLLECTION && item.status !== ItemStatus.ACTIVE) {
        return 0;
      }

      const shop = await this.shops.findOne({ where: { id: item.dropoffLocationId } });
      if (!shop) return 0;

      const publicPoint = publicLocationPoint(shop.latitude, shop.longitude);
      if (!publicPoint) return 0;
      const { longitude: lon, latitude: lat } = publicPoint;

      const point = `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`;
      const radiusMeters = this.getRadiusMeters();
      const maxRecipients = this.getMaxRecipients();

      const rows: Array<{ id: string; email: string }> = await this.dataSource.query(
        `SELECT u.id, u.email
           FROM "user" u
           JOIN address a ON a.user_id = u.id AND a.is_default = TRUE
          WHERE u.status = 'active'
            AND u.id <> $1
            AND ST_DWithin(a.geom::geography, ${point}::geography, $2)
          ORDER BY u.created_at DESC
          LIMIT ${maxRecipients}`,
        [item.donor?.id || null, radiusMeters],
      );

      if (!rows || rows.length === 0) return 0;

      const appBase = frontendOrigin();
      if (!appBase) return 0;
      const itemUrl = `${appBase}/items/${encodeURIComponent(item.id)}`;

      const subject = `New donation near you: ${item.title || 'An item'}`;
      const safeTitle = (item.title || '').toString().slice(0, 120);
      const safeCategory = (item.category || '').toString().slice(0, 80);
      const area = resolveOutwardPostcode(shop.postcode) || 'Area unavailable';

      const html = `
        <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
          <h2 style="margin:0 0 8px 0">New donation near you</h2>
          <p style="margin:0 0 6px 0"><strong>${this.escapeHtml(safeTitle)}</strong>${safeCategory ? ` &middot; ${this.escapeHtml(safeCategory)}` : ''
        }</p>
          <p style="margin:0 0 6px 0">Approximate area: <strong>${this.escapeHtml(area)}</strong></p>
          <p style="margin:0 0 12px 0">
            <a href="${itemUrl}" target="_blank"
               style="background:#0f766e;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">
               View item
            </a>
          </p>
          <p style="color:#555;font-size:12px">You're receiving this because there's a new donation within ~${Math.round(
          radiusMeters / 1000,
        )}km of your saved address.</p>
        </div>
      `;

      // Send sequentially; EmailService already no-ops if not configured
      let sent = 0;
      for (const r of rows) {
        if (!r?.email) continue;
        try {
            const delivery = await this.email.sendEmail({ to: r.email, subject, html });
            if (delivery.status === 'accepted') sent++;
        } catch (err) {
          this.logger.debug(safeFailure('nearby_email_delivery', err));
        }
      }
      if (sent > 0) this.logger.log({ operation: 'nearby_donation_email', sent });
      return sent;
    } catch (err) {
      this.logger.error(safeFailure('nearby_donation_email', err));
      return 0;
    }
  }

  /**
   * Send bulk email alerts for newly listed exchange items (when status is ACTIVE)
   */
  async sendNearbyItemExchangeEmails(itemId: string): Promise<number> {
    try {
      const item = await this.items.findOne({ where: { id: itemId }, relations: { donor: true } });
      if (!item) return 0;
      if (item.pickupOption !== ItemPickupOption.EXCHANGE) return 0;
      if (item.status !== ItemStatus.ACTIVE) return 0;

      // Target from the same public item cell used by public discovery.
      const publicPoint = publicLocationPoint(item.latitude, item.longitude);
      if (!publicPoint) return 0;
      const { longitude: lon, latitude: lat } = publicPoint;

      const point = `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`;
      const radiusMeters = this.getRadiusMeters();
      const maxRecipients = this.getMaxRecipients();

      const rows: Array<{ id: string; email: string }> = await this.dataSource.query(
        `SELECT u.id, u.email
           FROM "user" u
           JOIN address a ON a.user_id = u.id AND a.is_default = TRUE
          WHERE u.status = 'active'
            AND u.id <> $1
            AND ST_DWithin(a.geom::geography, ${point}::geography, $2)
          ORDER BY u.created_at DESC
          LIMIT ${maxRecipients}`,
        [item.donor?.id || null, radiusMeters],
      );

      if (!rows || rows.length === 0) return 0;

      const appBase = frontendOrigin();
      if (!appBase) return 0;
      const itemUrl = `${appBase}/items/${encodeURIComponent(item.id)}`;

      const subject = `New exchange near you: ${item.title || 'An item'}`;
      const safeTitle = (item.title || '').toString().slice(0, 120);
      const safeCategory = (item.category || '').toString().slice(0, 80);
      const area = resolveOutwardPostcode(item.postcode) || 'Area unavailable';

      const html = `
        <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
          <h2 style="margin:0 0 8px 0">New exchange near you</h2>
          <p style="margin:0 0 6px 0"><strong>${this.escapeHtml(safeTitle)}</strong>${safeCategory ? ` &middot; ${this.escapeHtml(safeCategory)}` : ''
        }</p>
          <p style="margin:0 0 6px 0">Approximate area: <strong>${this.escapeHtml(area)}</strong></p>
          <p style="margin:0 0 12px 0">
            <a href="${itemUrl}" target="_blank"
               style="background:#0f766e;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">
               View item
            </a>
          </p>
          <p style="color:#555;font-size:12px">You're receiving this because there's a new exchange within ~${Math.round(
          radiusMeters / 1000,
        )}km of your saved address.</p>
        </div>
      `;

      let sent = 0;
      for (const r of rows) {
        if (!r?.email) continue;
        try {
            const delivery = await this.email.sendEmail({ to: r.email, subject, html });
            if (delivery.status === 'accepted') sent++;
        } catch (err) {
          this.logger.debug(safeFailure('nearby_email_delivery', err));
        }
      }
      if (sent > 0) this.logger.log({ operation: 'nearby_exchange_email', sent });
      return sent;
    } catch (err) {
      this.logger.error(safeFailure('nearby_exchange_email', err));
      return 0;
    }
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

