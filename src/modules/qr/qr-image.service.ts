import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { v2 as cloudinary, UploadApiOptions, UploadApiResponse } from 'cloudinary';
import QRCode from 'qrcode';

function trimTrailingSlash(input: string): string {
  return input.replace(/\/$/, '');
}

@Injectable()
export class QrImageService {
  private readonly logger = new Logger(QrImageService.name);

  private readonly cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
  private readonly apiKey = process.env.CLOUDINARY_API_KEY || '';
  private readonly apiSecret = process.env.CLOUDINARY_API_SECRET || '';
  private readonly folder = process.env.CLOUDINARY_QR_FOLDER || 'qrs';

  constructor() {
    if (!this.cloudName || !this.apiKey || !this.apiSecret) {
      this.logger.warn('Cloudinary credentials are not fully configured; QR uploads will fail.');
    }
    cloudinary.config({
      cloud_name: this.cloudName,
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      secure: true,
    });
  }

  /**
   * Generate a QR PNG for an item and upload to Cloudinary.
   * Returns the publicly accessible URL to the PNG on success.
   */
  async generateAndUploadItemQrPng(itemId: string): Promise<string> {
    if (!itemId || typeof itemId !== 'string') {
      throw new InternalServerErrorException('Invalid item id for QR generation');
    }

    const qrContent = this.buildItemQrContent(itemId);
    const png = await this.generatePng(qrContent);
    const url = await this.uploadToCloudinary(png, `item-${itemId}`);
    return url;
  }

  private buildItemQrContent(itemId: string): string {
    // Encode a URL that can be handled by the backend (authenticated staff paths)
    const base = process.env.APP_BASE_URL ? trimTrailingSlash(process.env.APP_BASE_URL) : '';
    if (base) {
      return `${base}/qr/item/${itemId}/view`;
    }
    // Fallback to encoding just the item id
    return itemId;
  }

  private async generatePng(content: string): Promise<Buffer> {
    try {
      return await QRCode.toBuffer(content, {
        errorCorrectionLevel: 'M',
        type: 'png',
        margin: 1,
        scale: 8,
        color: { dark: '#000000', light: '#FFFFFF' },
      } as any);
    } catch (err) {
      this.logger.error(`Failed generating QR PNG: ${err instanceof Error ? err.message : err}`);
      throw new InternalServerErrorException('Failed to generate QR PNG');
    }
  }

  private async uploadToCloudinary(png: Buffer, basename: string): Promise<string> {
    const publicId = this.folder ? `${this.folder}/${basename}` : basename;
    const options: UploadApiOptions = {
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
      format: 'png',
    };

    const res: UploadApiResponse = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error('Empty Cloudinary response'));
        resolve(result as UploadApiResponse);
      });
      stream.end(png);
    });

    const url = res.secure_url || res.url;
    if (!url) {
      this.logger.error('Cloudinary upload succeeded but no URL returned');
      throw new InternalServerErrorException('QR upload did not return a URL');
    }
    return url;
  }
}

