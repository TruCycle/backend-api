import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class MessagesMediaService {
  async uploadImage(_buffer: Buffer, _originalName: string): Promise<string> {
    // No provider initialization or public-media uploads while attachments are
    // unavailable. Reopening requires private delivery and lifecycle cleanup.
    throw new ServiceUnavailableException('Image attachments are unavailable');
  }
}
