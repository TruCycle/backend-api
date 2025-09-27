import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { ClaimsService } from './claims.service';
import { CreateClaimDto } from './dto/create-claim.dto';

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a claim for an item', operationId: 'createClaim' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async create(@AuthUser() user: any, @Body() dto: CreateClaimDto) {
    return this.claims.createClaim(user, dto);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a pending claim', operationId: 'approveClaim' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async approve(@AuthUser() user: any, @Param('id') id: string) {
    return this.claims.approveClaim(user, id);
  }
}
