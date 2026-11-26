import { ValidationPipe } from '@nestjs/common';

import { ScanDto } from './qr.controller';

// Mirrors the global pipe in main.ts, which rejects properties without validators.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const parse = (body: unknown) => pipe.transform(body, { type: 'body', metatype: ScanDto });

describe('QR scan payload', () => {
  it('accepts the payload the frontend sends', async () => {
    await expect(parse({ qrPayload: 'QR:ITEM:1234', direction: 'out', shopId: 'shop-1' })).resolves.toMatchObject({ qrPayload: 'QR:ITEM:1234', direction: 'out' });
  });

  it('rejects an unknown direction and an empty payload', async () => {
    await expect(parse({ qrPayload: 'QR:ITEM:1234', direction: 'sideways' })).rejects.toThrow();
    await expect(parse({ qrPayload: '', direction: 'in' })).rejects.toThrow();
  });
});
