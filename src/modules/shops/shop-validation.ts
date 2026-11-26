import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { User, UserStatus } from '../users/user.entity';

import { Shop } from './shop.entity';

// Structural recognition only; a geocoder/owner must still establish the venue.
export const FULL_UK_POSTCODE_PATTERN = /^(?:[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}|GIR 0AA)$/;
export function normalizeFullUkPostcode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.trim().toUpperCase().replace(/\s+/g, '');
  const formatted = compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
  return FULL_UK_POSTCODE_PATTERN.test(formatted) ? formatted : null;
}

export interface ShopIdentity { name: string; addressLine: string; postcode: string }
export function normalizeShopIdentity(input: { name?: unknown; addressLine?: unknown; postcode?: unknown }): ShopIdentity {
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  const addressLine = typeof input.addressLine === 'string' ? input.addressLine.trim().replace(/\s+/g, ' ') : '';
  const postcode = normalizeFullUkPostcode(input.postcode);
  if (name.length < 2 || name.length > 120) throw new BadRequestException('Shop name must contain 2 to 120 characters');
  if (!addressLine || addressLine.length > 255) throw new BadRequestException('A shop address of up to 255 characters is required');
  if (!postcode) throw new BadRequestException('Enter a full UK postcode, for example SW1A 1AA');
  return { name, addressLine, postcode };
}

export async function withShopOwnerLock<T>(manager: EntityManager, ownerId: string,
  work: (transaction: EntityManager, owner: User) => Promise<T>, options: { allowInactiveOwner?: boolean } = {}): Promise<T> {
  if (!manager.queryRunner?.isTransactionActive) {
    return manager.transaction(transaction => withShopOwnerLock(transaction, ownerId, work, options));
  }
  const owner = await manager.getRepository(User).findOne({
    where: { id: ownerId }, loadEagerRelations: false, lock: { mode: 'pessimistic_write' },
  });
  if (!owner) throw new NotFoundException('Shop owner not found');
  if (!options.allowInactiveOwner && owner.status !== UserStatus.ACTIVE) throw new ForbiddenException('Inactive users cannot manage shops');
  return work(manager, owner);
}

const comparable = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export async function assertNoDuplicateShop(manager: EntityManager, ownerId: string, identity: ShopIdentity, excludeId?: string): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive) throw new Error('Shop identity checks require an active owner-locked transaction');
  const shops = await manager.getRepository(Shop).find({ where: { owner: { id: ownerId }, active: true },
    select: { id: true, name: true, addressLine: true, postcode: true } });
  if (shops.some(shop => shop.id !== excludeId && comparable(shop.name) === comparable(identity.name) &&
      comparable(shop.addressLine) === comparable(identity.addressLine) && normalizeFullUkPostcode(shop.postcode) === identity.postcode)) {
    throw new ConflictException('This active shop already exists. Edit the existing shop instead.');
  }
}
