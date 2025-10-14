import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';

import { RoleCode } from '../../users/role.entity';
import { CreateShopDto } from '../../shops/dto/create-shop.dto';

export class RegisterDto {
  @ApiProperty({ example: 'Jane' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  first_name!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  last_name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ enum: RoleCode, required: false })
  @IsOptional()
  role?: RoleCode;

  @ApiPropertyOptional({ description: 'Partner shop details (required when registering as a partner)', type: CreateShopDto })
  @IsOptional()
  shop?: CreateShopDto;
}
