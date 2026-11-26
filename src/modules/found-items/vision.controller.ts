import { BadRequestException, Controller, ForbiddenException, Header, HttpCode, Post, Req,
  ServiceUnavailableException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RoleCode } from '../users/role.entity';
import { VisionBudgetInterceptor } from './vision-budget.interceptor';

const maxImageBytes = 1.5 * 1024 * 1024;

@Controller('found-items/vision')
@UseGuards(JwtAuthGuard)
export class VisionController {
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(VisionBudgetInterceptor, FileInterceptor('image', {
    limits: { fileSize: maxImageBytes + 1, files: 1, fields: 1, parts: 3, fieldSize: 1024 },
  }))
  async classify(@Req() request: Request & { user?: { roles?: RoleCode[] } }, @UploadedFile() file?: Express.Multer.File) {
    const customPrompt: unknown = request.body?.prompt;
    if (customPrompt !== undefined && !request.user?.roles?.includes(RoleCode.ADMIN)) throw new ForbiddenException();
    if (customPrompt !== undefined && typeof customPrompt !== 'string') throw new BadRequestException('Invalid prompt');
    if (!file || file.size > maxImageBytes || file.buffer[0] !== 0xff || file.buffer[1] !== 0xd8 || file.buffer[2] !== 0xff) {
      throw new BadRequestException('A JPEG image up to 1.5 MB is required');
    }

    const secret = process.env.VISION_WORKER_SECRET;
    const endpoint = this.workerEndpoint(process.env.VISION_WORKER_URL);
    if (!endpoint || !secret || !/^[0-9a-f]{64}$/.test(secret)) throw new ServiceUnavailableException('Image analysis is unavailable');

    const body = new FormData();
    body.append('image', new Blob([new Uint8Array(file.buffer)], { type: 'image/jpeg' }), 'spot.jpg');
    body.append('prompt', customPrompt?.trim() || 'Analyze this item spotted on a UK street for TruCycle.');
    try {
      const response = await fetch(endpoint, {
        method: 'POST', body, redirect: 'error',
        headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const result: unknown = await response.json();
        return { status: 'success', message: 'OK', data: result };
      }
      await response.body?.cancel();
    } catch {
      // Upstream errors can contain URLs or transport details.
    }
    throw new ServiceUnavailableException('Image analysis is temporarily unavailable');
  }

  private workerEndpoint(value?: string): URL | undefined {
    if (!value) return undefined;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return url;
    } catch {
      return undefined;
    }
    return undefined;
  }
}
