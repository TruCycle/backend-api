import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { firstValueFrom, of } from 'rxjs';

import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';

import { VisionController } from './vision.controller';

describe('Vision API response integration', () => {
  it('preserves the Worker success flag and classification through the API envelope', async () => {
    const previousUrl = process.env.VISION_WORKER_URL;
    const previousSecret = process.env.VISION_WORKER_SECRET;
    process.env.VISION_WORKER_URL = 'https://vision-staging.example.invalid';
    process.env.VISION_WORKER_SECRET = 'a'.repeat(64);
    const payload = { success: true, data: { item_type: 'chair', suggested_category: 'Furniture' } };
    const transport = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => payload,
    } as Response);
    try {
      const controller = new VisionController();
      const result = await controller.classify({ body: {} } as Request, {
        size: 3, buffer: Buffer.from([0xff, 0xd8, 0xff]),
      } as Express.Multer.File);
      const context = {
        switchToHttp: () => ({ getResponse: () => ({ statusCode: 200 }) }),
        getHandler: () => controller.classify,
        getClass: () => VisionController,
      } as unknown as ExecutionContext;
      const response = await firstValueFrom(new ResponseInterceptor(new Reflector())
        .intercept(context, { handle: () => of(result) }));
      expect(response).toEqual({ status: 'success', message: 'OK', data: payload });
    } finally {
      transport.mockRestore();
      if (previousUrl === undefined) delete process.env.VISION_WORKER_URL;
      else process.env.VISION_WORKER_URL = previousUrl;
      if (previousSecret === undefined) delete process.env.VISION_WORKER_SECRET;
      else process.env.VISION_WORKER_SECRET = previousSecret;
    }
  });
});
