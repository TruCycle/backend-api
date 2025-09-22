import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';

@ApiTags('addresses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Post()
  async create(@AuthUser() user: any, @Body() dto: CreateAddressDto) {
    const created = await this.addresses.create(user.sub, dto);
    return {
      status: 'success',
      message: 'Address created successfully.',
      data: {
        id: created.id,
        label: created.label ?? null,
        line1: created.line1 ?? null,
        city: created.city ?? null,
        is_default: created.isDefault ?? false,
      },
    };
  }
}
