import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateFoundItemClaimDto } from './dto/create-found-item-claim.dto';
import { CreateFoundItemDto } from './dto/create-found-item.dto';
import { MyFoundItemsQueryDto } from './dto/my-found-items-query.dto';
import { ReportFoundItemDto } from './dto/report-found-item.dto';
import { SearchFoundItemsDto } from './dto/search-found-items.dto';
import { UpdateFoundItemStatusDto } from './dto/update-found-item-status.dto';
import { FoundItemsService } from './found-items.service';

@ApiTags('found-items')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('found-items')
export class FoundItemsController {
  constructor(private readonly foundItems: FoundItemsService) {}

  @Get()
  @ApiOperation({ summary: 'Browse found items' })
  @ApiOkResponse({ description: 'Found items and pagination' })
  async list(@Req() req: any, @Query() query: SearchFoundItemsDto): Promise<unknown> {
    return this.foundItems.list(req.user.id as string, query);
  }

  @Get('my-posts')
  @ApiOperation({ summary: 'List found items posted by the authenticated user' })
  @ApiOkResponse({ description: 'User posted found items and pagination' })
  async listMine(@Req() req: any, @Query() query: MyFoundItemsQueryDto): Promise<unknown> {
    return this.foundItems.listMine(req.user.id as string, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a found item by id' })
  @ApiOkResponse({ description: 'Found item details' })
  async getById(@Req() req: any, @Param('id') id: string): Promise<unknown> {
    return this.foundItems.getById(req.user.id as string, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new found item post' })
  @ApiCreatedResponse({ description: 'Found item created' })
  async create(@Req() req: any, @Body() dto: CreateFoundItemDto): Promise<unknown> {
    return this.foundItems.create(req.user.id as string, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update the status of a found item post' })
  @ApiOkResponse({ description: 'Updated found item' })
  async updateStatus(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateFoundItemStatusDto): Promise<unknown> {
    return this.foundItems.updateStatus(req.user.id as string, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a found item post' })
  @ApiNoContentResponse({ description: 'Found item deleted' })
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.foundItems.remove(req.user.id as string, id);
  }

  @Post(':id/claim')
  @ApiOperation({ summary: 'Express interest in picking up a found item' })
  @ApiCreatedResponse({ description: 'Found item claim created' })
  async claim(@Req() req: any, @Param('id') id: string, @Body() dto: CreateFoundItemClaimDto): Promise<unknown> {
    return this.foundItems.claim(req.user.id as string, id, dto);
  }

  @Delete(':id/claim')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cancel interest in a found item' })
  @ApiNoContentResponse({ description: 'Found item claim cancelled' })
  async cancelClaim(@Req() req: any, @Param('id') id: string) {
    await this.foundItems.cancelClaim(req.user.id as string, id);
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Report a found item post' })
  @ApiOkResponse({ description: 'Found item report recorded' })
  async report(@Req() req: any, @Param('id') id: string, @Body() dto: ReportFoundItemDto): Promise<unknown> {
    return this.foundItems.report(req.user.id as string, id, dto);
  }
}
