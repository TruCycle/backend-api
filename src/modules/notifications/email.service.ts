import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

interface ResendAttachment {
  filename: string;
  content: string;
  content_type: string;
  content_id?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  private static readonly INLINE_ASSETS: ReadonlyArray<{
    filename: string;
    contentId: string;
    mimeType: string;
  }> = [
    { filename: 'logo.png', contentId: 'trucycle-logo', mimeType: 'image/png' },
    { filename: 'linkedin.png', contentId: 'trucycle-linkedin', mimeType: 'image/png' },
    { filename: 'twitter.png', contentId: 'trucycle-twitter-icon', mimeType: 'image/png' },
    { filename: 'instagram.png', contentId: 'trucycle-instagram', mimeType: 'image/png' },
    { filename: 'password-lock.png', contentId: 'trucycle-password-lock', mimeType: 'image/png' },
  ];

  private async loadInlineAttachments(html: string): Promise<ResendAttachment[]> {
    const matchesCid = (cid: string) => html.includes(`cid:${cid}`);
    const required = EmailService.INLINE_ASSETS.filter((asset) => matchesCid(asset.contentId));
    if (required.length === 0) return [];

    const baseCandidates = [
      path.join(process.cwd(), 'public', 'email-assets'),
      path.join(__dirname, '..', '..', '..', 'public', 'email-assets'),
      path.join(__dirname, '..', '..', 'public', 'email-assets'),
    ];
    const baseDir = baseCandidates.find((candidate) => existsSync(candidate));
    if (!baseDir) {
      this.logger.warn('Inline email assets directory not found; sending email without inline images');
      return [];
    }

    const attachments: ResendAttachment[] = [];
    for (const asset of required) {
      try {
        const fullPath = path.join(baseDir, asset.filename);
        const buffer = await fs.readFile(fullPath);
        attachments.push({
          filename: asset.filename,
          content: buffer.toString('base64'),
          content_type: asset.mimeType,
          content_id: asset.contentId,
        });
      } catch (error) {
        this.logger.warn(`Failed to load inline asset ${asset.filename}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return attachments;
  }

  async sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM || 'no-reply@example.com';

    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not set; skipping email send');
      return;
    }

    try {
      const attachments = await this.loadInlineAttachments(html);
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, html, attachments }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.error(`Resend API error: ${res.status} ${res.statusText} ${text}`);
      }
    } catch (err: any) {
      this.logger.error('Failed to send email via Resend', err?.stack || err);
    }
  }
}
