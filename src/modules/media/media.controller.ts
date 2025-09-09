import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MediaService } from './media.service';
import { PresignPhotoDto } from './dto/presign-photo.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';

@ApiTags('media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presign-photo')
  async presignPhoto(@AuthUser() user: any, @Body() dto: PresignPhotoDto) {
    const res = await this.media.presignPhotoUpload(user.sub, dto.contentType, dto.maxSizeMB);
    return res;
  }

  @Get('signed-url')
  async getSignedUrl(@Query('key') key: string) {
    const url = await this.media.presignGetUrl(key);
    return { url };
  }
}

