import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

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
  @ApiBody({ description: 'Claim details', type: CreateClaimDto })
  @ApiCreatedResponse({
    description: 'Claim created successfully',
    schema: {
      example: {
        status: 'success',
        message: 'OK',
        data: {
          id: 'f2e2a1ab-12cd-4f34-98ee-6a1a93d7d7c1',
          status: 'pending',
        },
      },
    },
  })
  async create(@AuthUser() user: any, @Body() dto: CreateClaimDto) {
    return this.claims.createClaim(user, dto);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a pending claim', operationId: 'approveClaim' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Claim approved successfully',
    schema: { example: { status: 'success', message: 'OK', data: { id: 'f2e2a1ab-12cd-4f34-98ee-6a1a93d7d7c1', status: 'approved' } } },
  })
  async approve(@AuthUser() user: any, @Param('id') id: string) {
    return this.claims.approveClaim(user, id);
  }
}
