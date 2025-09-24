import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  create(@Body() body: any) {
    return { id: 'stub-claim', status: 'pending', ...body };
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateStatus(@Param('id') id: string, @Body() body: { action: string }) {
    return { id, action: body.action, result: 'ok' };
  }

  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
