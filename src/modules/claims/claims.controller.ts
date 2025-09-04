import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  @Post()
  create(@Body() body: any) {
    return { id: 'stub-claim', status: 'pending', ...body };
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { action: string }) {
    return { id, action: body.action, result: 'ok' };
  }

  @Get('health')
  health() {
    return { status: 'ok' };
  }
}

