import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

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
  ) {}

  private getRadiusMeters(): number {
    const envKm = Number(process.env.NEARBY_ITEM_ALERT_RADIUS_KM || 20);
    const km = Number.isFinite(envKm) && envKm > 0 ? Math.min(envKm, 200) : 20;
    return Math.round(km * 1000);
  }

  private getMaxRecipients(): number {
    const raw = Number(process.env.NEARBY_ITEM_ALERT_MAX_RECIPIENTS || 200);
    return Math.min(Math.max(Number.isFinite(raw) ? Math.trunc(raw) : 0, 1), 1000);
  }

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

      const lon = Number(shop.longitude);
      const lat = Number(shop.latitude);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 0;

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

      const appBase = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
      const itemUrl = `${appBase}/items/${encodeURIComponent(item.id)}`;

      const subject = `New donation near you: ${item.title || 'An item'} at ${shop.name}`;
      const safeTitle = (item.title || '').toString().slice(0, 120);
      const safeCategory = (item.category || '').toString().slice(0, 80);
      const shopAddress = [shop.addressLine, shop.postcode].filter(Boolean).join(', ');

      const html = `
        <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
          <h2 style="margin:0 0 8px 0">New donation near you</h2>
          <p style="margin:0 0 6px 0"><strong>${this.escapeHtml(safeTitle)}</strong>${
            safeCategory ? ` &middot; ${this.escapeHtml(safeCategory)}` : ''
          }</p>
          <p style="margin:0 0 6px 0">Available at <strong>${this.escapeHtml(shop.name)}</strong></p>
          <p style="margin:0 0 12px 0">${this.escapeHtml(shopAddress)}</p>
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
          await this.email.sendEmail({ to: r.email, subject, html });
          sent++;
        } catch (err) {
          this.logger.debug(`Email send failed to ${r.email}: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (sent > 0) this.logger.log(`Nearby donation alert sent for item ${item.id} to ${sent} user(s).`);
      return sent;
    } catch (err) {
      this.logger.error(`Failed nearby donation alert for item ${itemId}: ${err instanceof Error ? err.message : err}`);
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

