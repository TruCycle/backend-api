import { PartialType, PickType } from '@nestjs/swagger';

import { CreateItemDto } from './create-item.dto';

class UpdateItemBaseDto extends PickType(CreateItemDto, [
  'title',
  'description',
  'condition',
  'category',
  'addressLine',
  'postcode',
  'images',
  'deliveryPreferences',
  'metadata',
  'dropoffLocationId',
]) {}

export class UpdateItemDto extends PartialType(UpdateItemBaseDto) {}
