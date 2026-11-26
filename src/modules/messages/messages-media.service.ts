import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const MAX_MESSAGE_IMAGE_BYTES = 512 * 1024;
const MAX_IMAGE_DIMENSION = 2048;
const MAX_IMAGE_PIXELS = MAX_IMAGE_DIMENSION ** 2;

@Injectable()
export class MessagesMediaService {
  async prepareImage(buffer: Buffer) {
    if (!buffer.length) throw new BadRequestException('An image file is required');
    if (buffer.length > MAX_MESSAGE_IMAGE_BYTES) throw new PayloadTooLargeException('Image is too large');

    // Select the decoder from the bytes before invoking it. Filenames and MIME
    // headers are supplied by the client and do not determine the output type.
    const isJpeg = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const isPng = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isWebp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) throw new BadRequestException('Only JPEG, PNG and WebP images are accepted');

    let payload: Buffer;
    try {
      const image = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
      const { format, width, height, pages } = await image.metadata();
      if (format !== (isJpeg ? 'jpeg' : isPng ? 'png' : 'webp') ||
          !width || !height || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION ||
          (pages ?? 1) > 1) {
        throw new BadRequestException('Unsupported image format or dimensions');
      }
      payload = await image.autoOrient().webp({ quality: 85 }).toBuffer();
    } catch {
      throw new BadRequestException('Invalid or unsupported image');
    }

    if (payload.length > MAX_MESSAGE_IMAGE_BYTES) throw new PayloadTooLargeException('Processed image is too large');
    return { payload, contentType: 'image/webp', sourceDigest: createHash('sha256').update(buffer).digest() };
  }
}
