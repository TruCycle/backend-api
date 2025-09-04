import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('search')
@Controller('search')
export class SearchController {
  @Get('items')
  items(@Query('q') q?: string) {
    return { query: q || '', items: [] };
  }
}

