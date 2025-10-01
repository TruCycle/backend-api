import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { UploadApiOptions, UploadApiResponse, v2 as cloudinary } from 'cloudinary';

@Injectable()
export class MessagesMediaService {
  private readonly logger = new Logger(MessagesMediaService.name);

  private readonly folder = process.env.CLOUDINARY_MESSAGE_FOLDER || 'messages';

  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
    const apiKey = process.env.CLOUDINARY_API_KEY || '';
    const apiSecret = process.env.CLOUDINARY_API_SECRET || '';

    if (!cloudName || !apiKey || !apiSecret) {
      this.logger.warn('Cloudinary credentials are not fully configured; message uploads will fail.');
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  async uploadImage(buffer: Buffer, originalName: string): Promise<string> {
    try {
      const options: UploadApiOptions = {
        folder: this.folder,
        resource_type: 'image',
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        filename_override: originalName.replace(/\.[^.]+$/, ''),
      };

      const response: UploadApiResponse = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Empty Cloudinary response'));
          resolve(result);
        });
        stream.end(buffer);
      });

      const url = response.secure_url || response.url;
      if (!url) {
        this.logger.error('Cloudinary upload succeeded but returned no URL');
        throw new InternalServerErrorException('Image upload did not return a URL');
      }

      return url;
    } catch (error) {
      this.logger.error(`Failed to upload image to Cloudinary: ${error}`);
      throw new InternalServerErrorException('Failed to upload message image');
    }
  }
}
