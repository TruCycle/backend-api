import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { GeoService } from '../../geo/geo.service';
import { Claim, ClaimStatus } from '../claims/claim.entity';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import { Item } from '../items/item.entity';
import { RoleCode } from '../users/role.entity';
import { User, UserStatus } from '../users/user.entity';

import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { normalizeFullUkPostcode, normalizeShopIdentity } from './shop-validation';
import { Shop } from './shop.entity';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';

const body = { name: 'Reuse Hub', address_line: '1 High Street', postcode: 'sw1a1aa' };
describe('Shop structural input contract', () => {
  it.each(['SW1A1AA', 'EC1A 1HQ', 'M1 1AE', 'B33 8TH', 'W1A 0AX', 'DN55 1PT', 'GIR 0AA'])('formats full postcode %s without claiming allocation', value => {
    expect(normalizeFullUkPostcode(value)).toMatch(/^[A-Z0-9]+ [A-Z0-9]{3}$/);
  });
  it.each(['', ' ', 'SW1A', '12 High Street SW1A1AA', 'SW1A1AA London', 'GIR 9ZZ'])('rejects incomplete/address input %j', value => {
    expect(normalizeFullUkPostcode(value)).toBeNull();
  });
  it.each([{ address_line: ' ' }, { name: ' ' }, { postcode: '' }, { postcode: 'SW1A' }, { latitude: 91 }, { longitude: 181 }])('rejects invalid create DTO %j', async fields => {
    expect((await validate(plainToInstance(CreateShopDto, { ...body, ...fields }))).length).toBeGreaterThan(0);
  });
  it('normalizes actual transformed DTO compact postcode and preserves optional hours', async () => {
    const dto = plainToInstance(CreateShopDto, body);
    expect(await validate(dto)).toEqual([]);
    expect(dto.postcode).toBe('SW1A 1AA'); expect(dto.addressLine).toBe('1 High Street');
  });
  it.each([{ active: 'false' }, { latitude: -91 }, { longitude: -181 }, { address_line: ' ' }, { postcode: 'bad' }])('rejects invalid update DTO %j', async fields => {
    expect((await validate(plainToInstance(UpdateShopDto, fields))).length).toBeGreaterThan(0);
  });
  it.each([{ days: [], open_time: '09:00', close_time: '17:00' }, { days: ['Mon', 'Mon'], open_time: '09:00', close_time: '17:00' },
    { days: ['Holiday'], open_time: '09:00', close_time: '17:00' }, { days: ['Mon'], open_time: '29:00', close_time: '17:00' }])('validates published opening hours %j', async opening_hours => {
    expect((await validate(plainToInstance(CreateShopDto, { ...body, opening_hours }))).length).toBeGreaterThan(0);
  });
  it('rejects blank required identity when service callers bypass DTO validation', () => {
    expect(() => normalizeShopIdentity({ name: 'Hub', addressLine: ' ', postcode: 'SW1A 1AA' })).toThrow(BadRequestException);
  });
});

function fixture() {
  const actor = { id: 'owner', status: UserStatus.ACTIVE, userRoles: [{ role: { code: RoleCode.PARTNER } }] } as User;
  const rows: Shop[] = [];
  const users = { findOne: jest.fn(async () => actor) };
  const shops = {
    find: jest.fn(async () => rows.filter(shop => shop.active)),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      const found = rows.find(shop => shop.id === where.id); return found ? { ...found } : null;
    }),
    create: jest.fn((value: Partial<Shop>) => ({ ...value, id: `shop-${rows.length + 1}`, active: true })),
    save: jest.fn(async (shop: Shop) => { const index = rows.findIndex(row => row.id === shop.id); if (index < 0) rows.push(shop); else rows[index] = shop; return shop; }),
    count: jest.fn(async () => rows.filter(shop => shop.active).length), manager: {} as EntityManager,
  };
  const transaction = {
    queryRunner: { isTransactionActive: true },
    query: jest.fn(),
    getRepository: (entity: unknown) => entity === User ? users : shops,
  } as unknown as EntityManager;
  let queue = Promise.resolve();
  shops.manager = { transaction: async (work: (manager: EntityManager) => Promise<unknown>) => {
    const previous = queue; let release!: () => void; queue = new Promise(resolve => { release = resolve; });
    await previous; try { return await work(transaction); } finally { release(); }
  } } as EntityManager;
  const geocoding = { forwardGeocode: jest.fn().mockResolvedValue({ latitude: 51.51, longitude: -0.13 }) };
  const geo = { nearestShops: jest.fn().mockResolvedValue([]) };
  const itemQuery = {
    leftJoinAndSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };
  const items = { createQueryBuilder: jest.fn(() => itemQuery) };
  const claims = { find: jest.fn() };
  const service = new ShopsService(shops as unknown as Repository<Shop>, users as unknown as Repository<User>, items as unknown as Repository<Item>, claims as unknown as Repository<Claim>, geo as unknown as GeoService, geocoding as unknown as ItemGeocodingService);
  const dto = () => plainToInstance(CreateShopDto, body);
  return { actor, rows, users, shops, geocoding, geo, service, dto, itemQuery, claims };
}

describe('Shop write/visibility contracts with isolated repositories', () => {
  it('creates a normalized venue inside an active owner lock and retains owner notes', async () => {
    const f = fixture(); const dto = f.dto(); dto.operationalNotes = 'PRIVATE_STAFF_ENTRY';
    const result = await f.service.createShop({ sub: 'owner' }, dto);
    expect(result.postcode).toBe('SW1A 1AA'); expect(result.operational_notes).toBe('PRIVATE_STAFF_ENTRY');
    expect(f.users.findOne).toHaveBeenCalledWith(expect.objectContaining({ loadEagerRelations: false, lock: { mode: 'pessimistic_write' } }));
  });
  it('rejects case/spacing duplicate active venue while retaining differently addressed branches', async () => {
    const f = fixture(); await f.service.createShop({ sub: 'owner' }, f.dto());
    await expect(f.service.createShop({ sub: 'owner' }, { ...f.dto(), name: ' reuse  hub ', addressLine: '1 high STREET' })).rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.createShop({ sub: 'owner' }, { ...f.dto(), addressLine: '2 High Street' })).resolves.toBeDefined();
    expect(f.rows).toHaveLength(2);
  });
  it('serializes concurrent same-owner duplicate creates in the transaction model', async () => {
    const f = fixture(); const results = await Promise.allSettled([f.service.createShop({ sub: 'owner' }, f.dto()), f.service.createShop({ sub: 'owner' }, f.dto())]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(f.rows).toHaveLength(1);
  });
  it('does not geocode/write blank required fields or trust a stale partner/admin JWT', async () => {
    const f = fixture(); await expect(f.service.createShop({ sub: 'owner' }, { ...f.dto(), addressLine: ' ' })).rejects.toBeInstanceOf(BadRequestException);
    f.actor.userRoles = [];
    await expect(f.service.createShop({ sub: 'owner', roles: ['admin', 'partner'] }, f.dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.geocoding.forwardGeocode).not.toHaveBeenCalled(); expect(f.shops.save).not.toHaveBeenCalled();
  });
  it('does not invent coordinates after an invalid geocoder result', async () => {
    const f = fixture(); f.geocoding.forwardGeocode.mockResolvedValue({ latitude: null, longitude: null });
    await expect(f.service.createShop({ sub: 'owner' }, f.dto())).rejects.toBeInstanceOf(BadRequestException);
    expect(f.shops.save).not.toHaveBeenCalled();
  });
  it('public detail and nearby never return operational instructions; owner listing retains them', async () => {
    const f = fixture(); const dto = f.dto(); dto.operationalNotes = 'PRIVATE_STAFF_ENTRY';
    await f.service.createShop({ sub: 'owner' }, dto);
    expect((await f.service.getShopPublic('shop-1')).operational_notes).toBeNull();
    expect((await f.service.listMyShops({ sub: 'owner' }))[0].operational_notes).toBe('PRIVATE_STAFF_ENTRY');
    f.geo.nearestShops.mockResolvedValue([{ id: 'shop-1', latitude: null, longitude: null, operational_notes: 'PRIVATE_STAFF_ENTRY', distance_meters: null }]);
    const nearby = await f.service.findNearby(-0.13, 51.51, 5000);
    expect(nearby[0]).toMatchObject({ operational_notes: null, latitude: null, longitude: null, distanceMeters: null });
  });
  it('rejects out-of-range direct coordinate updates and active null', async () => {
    const f = fixture(); await f.service.createShop({ sub: 'owner' }, f.dto());
    await expect(f.service.updateShop({ sub: 'owner' }, 'shop-1', { latitude: 91 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.updateShop({ sub: 'owner' }, 'shop-1', { active: null } as unknown as UpdateShopDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.rows[0].latitude).toBe(51.51);
  });
  it('keeps one active venue across both deactivation entry points and permits archive retries', async () => {
    const f = fixture();
    await f.service.createShop({ sub: 'owner' }, f.dto());
    await expect(f.service.updateShop({ sub: 'owner' }, 'shop-1', { active: false }))
      .rejects.toThrow('At least one shop must remain active');
    await f.service.createShop({ sub: 'owner' }, { ...f.dto(), addressLine: '2 High Street' });
    await expect(f.service.updateShop({ sub: 'owner' }, 'shop-1', { active: false }))
      .resolves.toMatchObject({ active: false });
    await expect(f.service.deleteShop({ sub: 'owner' }, 'shop-1')).resolves.toBeUndefined();
    await expect(f.service.deleteShop({ sub: 'owner' }, 'shop-2'))
      .rejects.toThrow('At least one shop must remain active');
    expect(f.rows.filter(shop => shop.active).map(shop => shop.id)).toEqual(['shop-2']);
  });
  it.each(['one shop', 'my shops'])('keeps email-derived collector names out of partner item results for %s', async route => {
    const f = fixture();
    const actor = { sub: 'owner' };
    const shop = await f.service.createShop(actor, f.dto());
    const items = ['first', 'second'].map(id => ({ id, dropoffLocationId: shop.id }));
    f.itemQuery.getManyAndCount.mockResolvedValue([items, items.length]);
    f.claims.find.mockResolvedValue([
      { id: 'claim-1', status: ClaimStatus.APPROVED, item: items[0], collector: {
        id: 'collector-1', email: 'PRIVATE_EMAIL_PREFIX@example.invalid', firstName: null, lastName: ' ',
      } },
      { id: 'claim-2', status: ClaimStatus.APPROVED, item: items[1], collector: {
        id: 'collector-2', email: 'named@example.invalid', firstName: 'Test', lastName: 'Collector',
      } },
    ]);
    const result = route === 'one shop'
      ? await f.service.listShopItems(actor, shop.id, {})
      : await f.service.listMyShopItems(actor, {});
    expect(result.items.map(item => item.claim?.collector?.name)).toEqual(['Community member', 'Test Collector']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_EMAIL_PREFIX');
  });
});

describe('Metre-based nearby query', () => {
  it('parameterizes the geography radius and stable distance order', async () => {
    const query = jest.fn().mockResolvedValue([]); const geo = new GeoService({ query } as unknown as DataSource);
    await geo.nearestShops(-0.13, 51.51, 5000);
    expect(query.mock.calls[0][0]).toContain('ST_DWithin(geom::geography,');
    expect(query.mock.calls[0][0]).toContain('ORDER BY distance_meters ASC, id ASC');
    expect(query.mock.calls[0][1]).toEqual([-0.13, 51.51, 5000]);
    expect(query.mock.calls[0][0]).not.toContain('operational_notes');
  });
  it.each([[NaN, 0, 5000], [181, 0, 5000], [0, 91, 5000], [0, 0, 0], [0, 0, Infinity]])('rejects invalid numeric query %j', async (lon, lat, radius) => {
    const query = jest.fn(); await expect(new GeoService({ query } as unknown as DataSource).nearestShops(lon, lat, radius)).rejects.toBeInstanceOf(BadRequestException); expect(query).not.toHaveBeenCalled();
  });
  it('rejects blank coordinate/radius query values rather than coercing to zero', async () => {
    const nearby = jest.fn(); const controller = new ShopsController({ findNearby: nearby } as unknown as ShopsService);
    await expect(controller.nearby('', '', undefined, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.nearby('0', '0', undefined, '')).rejects.toBeInstanceOf(BadRequestException);
    expect(nearby).not.toHaveBeenCalled();
  });
});
