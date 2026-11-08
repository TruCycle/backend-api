import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, type FindOneOptions } from 'typeorm';
import { RawSqlResultsToEntityTransformer } from 'typeorm/query-builder/transformer/RawSqlResultsToEntityTransformer';

import { Claim, ClaimStatus } from '../claims/claim.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { QrImageService } from '../qr/qr-image.service';
import { UserReview } from '../reviews/user-review.entity';
import { Shop } from '../shops/shop.entity';
import { KycProfile, KycStatus } from '../users/kyc-profile.entity';
import { Role } from '../users/role.entity';
import { UserRole } from '../users/user-role.entity';
import { User, UserStatus } from '../users/user.entity';

import { Co2EstimationService } from './co2-estimation.service';
import { ItemGeocodingService } from './item-geocoding.service';
import { Item, ItemCondition, ItemPickupOption, ItemStatus, SizeUnit } from './item.entity';
import { ItemsService } from './items.service';
import { PUBLIC_ITEM_GEOGRAPHY_SQL } from './public-item-location';

function queryMock() {
  return {
    select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(), offset: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(), setParameters: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(), getMany: jest.fn(), getRawMany: jest.fn(), getRawOne: jest.fn(),
  };
}

const viewers = [
  ['guest', undefined], ['unrelated user', 'unrelated-id'],
  ['current claimant', 'claimant-id'], ['listing owner', 'donor-id'],
] as const;

describe.each(['real names', 'email fallback'])('Public donor privacy with %s', (profile) => {
  let service: ItemsService;
  let donor: User;
  let item: Item;
  let claim: Claim;
  let itemQuery: ReturnType<typeof queryMock>;
  let donorQuery: ReturnType<typeof queryMock>;

  const items = { findOne: jest.fn(), query: jest.fn(), createQueryBuilder: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn() };
  const notifications = { notifyNearbyItem: jest.fn() };
  const users = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
  const claims = { find: jest.fn(), findOne: jest.fn(), createQueryBuilder: jest.fn() };
  const shops = { find: jest.fn(), findOne: jest.fn() };
  const kycs = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
  const reviews = { createQueryBuilder: jest.fn() };
  const geocoding = { forwardGeocode: jest.fn() };

  function expectedOwner() {
    return {
      id: donor.id, name: 'Community member', profile_image: donor.profileImageUrl,
      verification: { email_verified: true, identity_verified: true, address_verified: true },
      rating: 4.3, reviews_count: 6,
    };
  }

  function assertNoPrivateDonorIdentity(value: unknown) {
    const serialized = JSON.stringify(value);
    for (const sentinel of ['DONOR_PRIVATE_FIRST', 'DONOR_PRIVATE_LAST', 'donor-email-sentinel']) {
      expect(serialized).not.toContain(sentinel);
    }
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    donor = Object.assign(new User(), {
      id: 'donor-id',
      firstName: profile === 'real names' ? 'DONOR_PRIVATE_FIRST' : null,
      lastName: profile === 'real names' ? 'DONOR_PRIVATE_LAST' : null,
      email: 'donor-email-sentinel@example.test',
      status: UserStatus.ACTIVE,
      profileImageUrl: 'https://example.test/avatar.png',
    });
    item = Object.assign(new Item(), {
      id: 'item-id',
      // Match the id-only donor shape supplied by loadRelationIds in the detail query.
      donor: Object.assign(new User(), { id: donor.id }),
      title: 'Test chair', description: 'Synthetic item', status: ItemStatus.ACTIVE,
      condition: ItemCondition.GOOD, category: 'furniture', pickupOption: ItemPickupOption.EXCHANGE,
      metadata: { private_location: 'PRIVATE_METADATA' }, addressLine: 'PRIVATE_STREET',
      images: [], latitude: 51.5, longitude: 0.06, postcode: 'E16 2RD',
      createdAt: new Date('2026-11-02T10:00:00Z'),
    });
    claim = Object.assign(new Claim(), {
      id: 'claim-id', item, status: ClaimStatus.PENDING_APPROVAL,
      collector: Object.assign(new User(), {
        id: 'claimant-id', firstName: 'Authorized', lastName: 'Collector',
      }),
      createdAt: new Date('2026-11-02T11:00:00Z'),
    });

    items.findOne.mockResolvedValue(item);
    items.query.mockImplementation(async (sql: string) => {
      if (sql.includes('item_scan_event')) return [{ scan_type: 'in', shop_id: 'PRIVATE_SCAN', scanned_at: '2026-11-02T10:00:00Z' }];
      if (sql.includes('GROUP BY user_id')) return [{ user_id: donor.id, cnt: '1' }];
      if (sql.includes('COUNT(1)')) return [{ cnt: '1' }];
      return [];
    });
    // Return a full synthetic donor even though the projection requests safe fields:
    // this catches accidental reintroduction of real-name/email label fallbacks.
    users.findOne.mockResolvedValue(donor);
    kycs.findOne.mockResolvedValue({ status: KycStatus.APPROVED });
    claims.findOne.mockImplementation(async ({ where }: { where: { collector: { id: string } } }) =>
      where.collector.id === claim.collector.id ? claim : null,
    );
    claims.find.mockImplementation(async ({ where }: { where: { collector?: { id: string } } }) =>
      !where.collector || where.collector.id === claim.collector.id ? [claim] : [],
    );
    itemQuery = queryMock();
    itemQuery.getRawMany.mockResolvedValue([{
      id: item.id, title: item.title, status: item.status, condition: item.condition,
      category: item.category, pickup_option: item.pickupOption, donor_id: donor.id,
      images: [], created_at: item.createdAt, distance_meters: 1250,
    }]);
    items.createQueryBuilder.mockReturnValue(itemQuery);
    donorQuery = queryMock();
    donorQuery.getMany.mockResolvedValue([donor]);
    users.createQueryBuilder.mockReturnValue(donorQuery);
    const kycQuery = queryMock();
    kycQuery.getRawMany.mockResolvedValue([{ user_id: donor.id, status: KycStatus.APPROVED }]);
    kycs.createQueryBuilder.mockReturnValue(kycQuery);
    const reviewQuery = queryMock();
    reviewQuery.getRawOne.mockResolvedValue({ avg_rating: 4.25, reviews_count: '6' });
    reviewQuery.getRawMany.mockResolvedValue([{ user_id: donor.id, avg_rating: 4.25, reviews_count: '6' }]);
    reviews.createQueryBuilder.mockReturnValue(reviewQuery);
    geocoding.forwardGeocode.mockResolvedValue({ latitude: 51.5, longitude: 0.06 });

    // No AppModule, database connection or external service is started.
    const moduleRef = await Test.createTestingModule({
      providers: [
        ItemsService,
        { provide: getRepositoryToken(Item), useValue: items },
        { provide: getRepositoryToken(Claim), useValue: claims },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(KycProfile), useValue: kycs },
        { provide: getRepositoryToken(UserReview), useValue: reviews },
        { provide: getRepositoryToken(Shop), useValue: shops },
        { provide: ItemGeocodingService, useValue: geocoding },
        { provide: QrImageService, useValue: {} },
        { provide: Co2EstimationService, useValue: {} },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(ItemsService);
  });

  it.each(viewers)('neutralises the detail donor for %s while preserving verification and claim permissions', async (_role, viewerId) => {
    const result = await service.getPublicItem(item.id, viewerId);

    expect(result.owner).toEqual(expectedOwner());
    expect(result.location).toEqual(viewerId === donor.id
      ? { address_line: item.addressLine, postcode: item.postcode, latitude: item.latitude, longitude: item.longitude, precision: 'exact' }
      : { address_line: null, postcode: 'E16', latitude: 51.51, longitude: 0.07, precision: 'approximate' });
    assertNoPrivateDonorIdentity(result);
    expect(items.findOne).toHaveBeenCalledWith({
      where: { id: item.id }, loadRelationIds: { relations: ['donor'], disableMixedMap: true },
      loadEagerRelations: false,
    });
    expect(users.findOne).toHaveBeenCalledWith({
      where: { id: donor.id }, select: { id: true, status: true, profileImageUrl: true },
      loadEagerRelations: false,
    });
    expect(kycs.findOne).toHaveBeenCalledWith({
      where: { user: { id: donor.id } }, select: { id: true, status: true },
      loadEagerRelations: false,
    });
    if (viewerId === donor.id) {
      expect(result.claims[0].collector).toEqual({
        id: claim.collector.id, name: 'Authorized Collector', profile_image: null,
      });
      expect(claims.find).toHaveBeenCalledWith({ where: { item: { id: item.id } }, relations: ['collector'] });
    } else {
      expect(result.claims).toEqual([]);
      expect(claims.find).not.toHaveBeenCalled();
    }
    expect(result.claim).toEqual(viewerId === claim.collector.id ? {
      status: claim.status, requested_at: claim.createdAt.toISOString(), claimed_at: null,
    } : null);
  });

  it.each(viewers)('neutralises search donors for %s and preserves search/own-claim behaviour', async (_role, viewerId) => {
    const result = await service.searchPublicListings({
      lat: 51.5, lng: 0.06, radius: 7, limit: 12, page: 2,
      status: ItemStatus.ACTIVE, category: ' Furniture ',
    }, viewerId);

    expect(result.items[0].owner).toEqual(expectedOwner());
    expect(result.items[0].distance_km).toBe(1.3);
    expect(result.search_origin).toEqual({ lat: 51.5, lng: 0.06, radius_km: 7 });
    assertNoPrivateDonorIdentity(result);
    expect(donorQuery.select).toHaveBeenCalledWith(['u.id', 'u.status', 'u.profileImageUrl']);
    expect(donorQuery.where).toHaveBeenCalledWith('u.id IN (:...ids)', { ids: [donor.id] });
    expect(itemQuery.where).toHaveBeenCalledWith('item.status IN (:...statuses)', { statuses: [ItemStatus.ACTIVE] });
    expect(itemQuery.andWhere).toHaveBeenCalledWith('LOWER(item.category) = :category', { category: 'furniture' });
    expect(itemQuery.offset).toHaveBeenCalledWith(12);
    expect(itemQuery.limit).toHaveBeenCalledWith(12);
    expect(itemQuery.setParameters).toHaveBeenCalledWith({ originLat: 51.5, originLng: 0.06, radiusMeters: 7000 });
    expect(geocoding.forwardGeocode).not.toHaveBeenCalled();
    expect(result.items[0].claim).toEqual(viewerId === claim.collector.id ? {
      status: claim.status, requested_at: claim.createdAt.toISOString(), claimed_at: null,
    } : null);
    if (viewerId) {
      expect(claims.find).toHaveBeenCalledWith({
        where: { collector: { id: viewerId }, item: { id: expect.anything() } },
      });
    } else expect(claims.find).not.toHaveBeenCalled();
  });

  it('uses the same public SQL point for distance and membership, never raw geometry', async () => {
    await service.searchPublicListings({ lat: 51.5, lng: 0.06 });
    expect(itemQuery.addSelect).toHaveBeenCalledWith(
      expect.stringContaining('ST_Distance((' + PUBLIC_ITEM_GEOGRAPHY_SQL + ')'), 'distance_meters');
    expect(itemQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('ST_DWithin((' + PUBLIC_ITEM_GEOGRAPHY_SQL + ')'));
    const expressions = JSON.stringify([itemQuery.addSelect.mock.calls, itemQuery.andWhere.mock.calls]);
    expect(expressions).not.toContain('item.location');
    expect(PUBLIC_ITEM_GEOGRAPHY_SQL).toContain('item.latitude BETWEEN -90 AND 90');
    expect(PUBLIC_ITEM_GEOGRAPHY_SQL).toContain('FLOOR(item.longitude * 50)');
    expect(itemQuery.orderBy).toHaveBeenCalledWith('distance_meters', 'ASC');
  });

  it('browses a catalogue with no invented origin or distance and keeps unavailable-location items', async () => {
    const result = await service.searchPublicListings({});
    expect(result.search_origin).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].distance_km).toBeNull();
    expect(result.items[0].location.precision).toBe('unavailable');
    expect(geocoding.forwardGeocode).not.toHaveBeenCalled();
    expect(itemQuery.setParameters).not.toHaveBeenCalled();
    expect(itemQuery.andWhere).not.toHaveBeenCalled();
    expect(itemQuery.orderBy).toHaveBeenCalledWith('item.created_at', 'DESC');
  });

  it.each([{ lat: 51.5 }, { lng: 0 }, { lat: NaN, lng: 0 }, { lat: 91, lng: 0 }])(
    'rejects explicit partial/invalid origins %j without querying items', async (dto) => {
      await expect(service.searchPublicListings(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(items.createQueryBuilder).not.toHaveBeenCalled();
    });

  it.each(viewers)('protects metadata and scan history for %s', async (_role, viewerId) => {
    const result = await service.getPublicItem(item.id, viewerId);
    const owner = viewerId === donor.id;
    expect(result.metadata_redacted).toBe(!owner);
    expect(result.scan_events_redacted).toBe(!owner);
    expect(result.metadata).toEqual(owner ? item.metadata : null);
    expect(result.scan_events).toHaveLength(owner ? 1 : 0);
    expect(items.query.mock.calls.some(([sql]) => sql.includes('item_scan_event'))).toBe(owner);
    if (!owner) for (const sentinel of ['PRIVATE_METADATA', 'PRIVATE_STREET', 'PRIVATE_SCAN', 'E16 2RD']) {
      expect(JSON.stringify(result)).not.toContain(sentinel);
    }
  });

  it.each(Object.values(ClaimStatus))('claim status %s never grants exact detail or claimant-list location', async (status) => {
    claim.status = status;
    const detail = await service.getPublicItem(item.id, claim.collector.id);
    const query = queryMock();
    query.getManyAndCount.mockResolvedValue([[claim], 1]);
    claims.createQueryBuilder.mockReturnValue(query);
    const collected = await service.getUserCollectedItems(claim.collector.id, { claim_status: status });
    expect(query.where).toHaveBeenCalledWith('claim.collector_id = :userId', { userId: claim.collector.id });
    expect(query.andWhere).toHaveBeenCalledWith('claim.status = :claimStatus', { claimStatus: status });
    expect(collected.items[0].claim_status).toBe(status);
    expect(collected.items[0].item?.location).toEqual(detail.location);
    expect(collected.items[0].item?.metadata).toBeNull();
    expect(collected.items[0].item?.metadata_redacted).toBe(true);
    expect(detail.location).toEqual({ address_line: null, postcode: 'E16', latitude: 51.51, longitude: 0.07, precision: 'approximate' });
  });

  it('preserves active facility directions while stripping private operational notes from public detail', async () => {
    item.dropoffLocationId = 'facility-id';
    shops.findOne.mockResolvedValue({ id: 'facility-id', name: 'Community facility', addressLine: 'Published facility address',
      postcode: 'E16 2AB', latitude: 51.4, longitude: 0.1, active: true, operationalNotes: 'PRIVATE_FACILITY_NOTES' });
    const guest = await service.getPublicItem(item.id);
    const owner = await service.getPublicItem(item.id, donor.id);
    expect(guest.dropoff_location).toMatchObject({ address_line: 'Published facility address', postcode: 'E16 2AB', operational_notes: null });
    expect(owner.dropoff_location?.operational_notes).toBe('PRIVATE_FACILITY_NOTES');
    expect(shops.findOne).toHaveBeenCalledWith({ where: { id: 'facility-id', active: true } });
  });

  it('same-cell items target identical nearby recipients at a radius boundary and send only outward location', async () => {
    donorQuery.getMany.mockResolvedValue([
      { id: 'inside', postcode: 'INSIDE' }, { id: 'outside', postcode: 'OUTSIDE' },
    ]);
    items.create.mockImplementation((value) => ({ ...value, id: item.id, createdAt: item.createdAt }));
    items.save.mockImplementation(async (value) => value);
    for (const latitude of [51.5001, 51.5199]) {
      notifications.notifyNearbyItem.mockClear();
      geocoding.forwardGeocode.mockImplementation(async (postcode: string) => ({
        latitude: postcode === 'INSIDE' ? 51.5998 : postcode === 'OUTSIDE' ? 51.6001 : latitude,
        longitude: 0.07,
      }));
      const created = await service.createItem(donor.id, {
        title: 'Chair', condition: ItemCondition.GOOD, category: 'furniture', pickupOption: ItemPickupOption.EXCHANGE,
        postcode: 'E16 2RD', addressLine: 'PRIVATE_STREET',
        sizeUnit: SizeUnit.M, sizeLength: 1, sizeBreadth: 1, sizeHeight: 1, weightKg: 5,
      });
      expect(created.location).toMatchObject({ latitude, longitude: 0.07, postcode: 'E16 2RD', precision: 'exact' });
      expect(notifications.notifyNearbyItem.mock.calls).toEqual([['inside', item.id, 'Chair', 'E16']]);
    }
  });

  it('persists missing measurements as unknown rather than fictional activity', async () => {
    items.create.mockImplementation(value => ({ ...value, id: item.id, createdAt: item.createdAt }));
    items.save.mockImplementation(async value => value);
    await service.createItem(donor.id, {
      title: 'Chair', condition: ItemCondition.GOOD, category: 'furniture', pickupOption: ItemPickupOption.EXCHANGE,
      postcode: 'E16 2RD', addressLine: 'PRIVATE_STREET',
    });
    expect(items.create).toHaveBeenCalledWith(expect.objectContaining({
      weightKg: null, sizeUnit: null, sizeLength: null, sizeBreadth: null, sizeHeight: null,
    }));
  });

  it('still prioritises an explicit postcode over coordinates using only the mocked geocoder', async () => {
    await service.searchPublicListings({ postcode: 'E16 2RD', lat: 0, lng: 0 });
    expect(geocoding.forwardGeocode).toHaveBeenCalledWith('E16 2RD');
    expect(itemQuery.setParameters).toHaveBeenCalledWith({ originLat: 51.5, originLng: 0.06, radiusMeters: 5000 });
  });

  it('continues rejecting non-public search statuses before retrieving donors', async () => {
    await expect(service.searchPublicListings({ lat: 51.5, lng: 0.06, status: ItemStatus.DRAFT }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(users.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('the installed ORM keeps donor.id without selecting private donor columns, entirely offline', async () => {
    await service.getPublicItem(item.id);
    const options = items.findOne.mock.calls[0][0] as FindOneOptions<Item>;
    const metadataOnly = new DataSource({
      type: 'postgres', host: 'metadata-only.invalid', database: 'metadata-only',
      entities: [Item, User, UserRole, Role, KycProfile],
      synchronize: false, migrationsRun: false, installExtensions: false,
    });
    // This builds decorators/relations in memory; initialize/connect/query are never called.
    await (metadataOnly as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    const query = metadataOnly.getRepository(Item).createQueryBuilder('item').setFindOptions(options);
    const sql = query.getSql();
    expect(sql).toContain('"item"."donor_id"');
    expect(sql).not.toMatch(/first_name|last_name|email|JOIN\s+"user"/i);
    expect(query.expressionMap.joinAttributes).toHaveLength(0);
    const relationId = query.expressionMap.relationIdAttributes[0];
    expect(relationId.relationPropertyPath).toBe('donor');
    expect(relationId.disableMixedMap).toBe(true);

    const transformer = new RawSqlResultsToEntityTransformer(
      query.expressionMap, metadataOnly.driver,
      [{ relationIdAttribute: relationId, results: [{ id: item.id, donor_id: donor.id }] }], [],
    );
    const transformed = transformer.transform([{
      item_id: item.id, item_title: item.title, item_donor_id: donor.id,
    }], query.expressionMap.mainAlias!) as Item[];
    expect(transformed[0].donor).toEqual({ id: donor.id });
    expect(transformed[0].title).toBe(item.title);
    expect(metadataOnly.isInitialized).toBe(false);
  });
});
