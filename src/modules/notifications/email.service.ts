import { Injectable, Logger } from '@nestjs/common';

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM || 'no-reply@example.com';

    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not set; skipping email send');
      return;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, html }),
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

