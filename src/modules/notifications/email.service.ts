import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

interface EmailAttachment {
  filename: string;
  content: string;
  content_type: string;
  content_id?: string;
}

export interface ProviderStatus {
  activeProvider: 'brevo' | 'resend' | 'none';
  fallbackProvider: 'resend' | null;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);

  private static readonly BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

  private static readonly RESEND_API_URL = 'https://api.resend.com/emails';

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

  onModuleInit(): void {
    const provider = this.getProviderStatus();
    if (provider.activeProvider === 'none') {
      this.logger.warn('Email provider inactive; set BREVO_API_KEY or RESEND_API_KEY to enable transactional email');
      return;
    }

    this.logger.log(
      `Email provider active: ${provider.activeProvider}${provider.fallbackProvider ? ` (fallback: ${provider.fallbackProvider})` : ''}`,
    );
  }

  getProviderStatus(): ProviderStatus {
    const hasBrevo = Boolean(process.env.BREVO_API_KEY);
    const hasResend = Boolean(process.env.RESEND_API_KEY);

    if (hasBrevo) {
      return { activeProvider: 'brevo', fallbackProvider: hasResend ? 'resend' : null };
    }

    if (hasResend) {
      return { activeProvider: 'resend', fallbackProvider: null };
    }

    return { activeProvider: 'none', fallbackProvider: null };
  }

  private getBackendBaseUrl(): string {
    return (process.env.BACKEND_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  }

  private rewriteHtmlForBrevo(html: string): string {
    const backendBase = this.getBackendBaseUrl();

    return EmailService.INLINE_ASSETS.reduce((updatedHtml, asset) => {
      const publicAssetUrl = `${backendBase}/email-assets/${asset.filename}`;
      return updatedHtml.split(`cid:${asset.contentId}`).join(publicAssetUrl);
    }, html);
  }

  private async loadInlineAttachments(html: string): Promise<EmailAttachment[]> {
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

    const attachments: EmailAttachment[] = [];
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

  private parseFromAddress(from: string): { email: string; name?: string } {
    const trimmed = from.trim();
    const match = trimmed.match(/^(.*)<([^>]+)>$/);
    if (!match) {
      return { email: trimmed };
    }

    const [, rawName, rawEmail] = match;
    const email = rawEmail.trim();
    const name = rawName.trim().replace(/^"|"$/g, '');
    return name ? { email, name } : { email };
  }

  private async sendViaBrevo(
    apiKey: string,
    from: string,
    { to, subject, html }: SendEmailParams,
    attachments: EmailAttachment[],
  ): Promise<void> {
    const regularAttachments = attachments.filter((attachment) => !attachment.content_id);
    const payload: Record<string, unknown> = {
      sender: this.parseFromAddress(from),
      to: [{ email: to }],
      subject,
      htmlContent: this.rewriteHtmlForBrevo(html),
    };

    if (regularAttachments.length > 0) {
      payload.attachment = regularAttachments.map((attachment) => ({
        name: attachment.filename,
        content: attachment.content,
      }));
    }

    const res = await fetch(EmailService.BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Brevo API error: ${res.status} ${res.statusText} ${text}`);
    }
  }

  private async sendViaResend(
    apiKey: string,
    from: string,
    { to, subject, html }: SendEmailParams,
    attachments: EmailAttachment[],
  ): Promise<void> {
    const res = await fetch(EmailService.RESEND_API_URL, {
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
  }

  async sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
    const brevoApiKey = process.env.BREVO_API_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM || 'no-reply@example.com';

    if (!brevoApiKey && !resendApiKey) {
      this.logger.warn('No email provider configured; set BREVO_API_KEY or RESEND_API_KEY');
      return;
    }

    try {
      const attachments = await this.loadInlineAttachments(html);
      if (brevoApiKey) {
        await this.sendViaBrevo(brevoApiKey, from, { to, subject, html }, attachments);
        return;
      }

      await this.sendViaResend(resendApiKey!, from, { to, subject, html }, attachments);
    } catch (err: any) {
      const provider = brevoApiKey ? 'Brevo' : 'Resend';
      this.logger.error(`Failed to send email via ${provider}`, err?.stack || err);
    }
  }
}
