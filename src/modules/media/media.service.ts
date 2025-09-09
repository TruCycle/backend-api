import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { createPresignedPost, PresignedPost } from '@aws-sdk/s3-presigned-post';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

function extForContentType(ct: string): string {
  switch (ct) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/heic':
      return '.heic';
    case 'image/heif':
      return '.heif';
    default:
      return '';
  }
}

@Injectable()
export class MediaService {
  private readonly bucket = process.env.S3_BUCKET || 'trucycle';
  private readonly region = process.env.S3_REGION || 'us-east-1';
  private readonly forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';
  private readonly endpoint = process.env.S3_ENDPOINT || undefined;
  private readonly expiresSeconds = parseInt(process.env.S3_PRESIGN_EXPIRES || '900', 10); // 15m

  private readonly s3: S3Client;

  constructor() {
    this.s3 = new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      forcePathStyle: this.forcePathStyle,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
      },
    });
  }

  private async assertBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (e) {
      throw new InternalServerErrorException('S3 bucket not accessible');
    }
  }

  async presignPhotoUpload(userId: string, contentType: string, maxSizeMB = 8): Promise<{
    key: string;
    post: PresignedPost;
    expiresIn: number;
  }> {
    if (!contentType.startsWith('image/')) {
      throw new BadRequestException('Only image content types are allowed');
    }
    await this.assertBucket();
    const key = `uploads/photos/${userId}/${uuidv4()}${extForContentType(contentType)}`;
    const maxBytes = maxSizeMB * 1024 * 1024;
    const post = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, maxBytes],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: {
        'Content-Type': contentType,
      },
      Expires: this.expiresSeconds,
    });
    return { key, post, expiresIn: this.expiresSeconds };
  }

  async presignGetUrl(key: string, expiresSeconds = this.expiresSeconds): Promise<string> {
    await this.assertBucket();
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, cmd, { expiresIn: expiresSeconds });
  }

  async presignPutUrl(key: string, contentType: string): Promise<string> {
    await this.assertBucket();
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.s3, cmd, { expiresIn: this.expiresSeconds });
  }
}

