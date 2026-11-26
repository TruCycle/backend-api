import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { GamificationService } from '../gamification/gamification.service';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { User, UserStatus } from '../users/user.entity';

import { FoundItemSortBy } from './dto/search-found-items.dto';
import { FoundItemClaim, FoundItemClaimStatus } from './found-item-claim.entity';
import { FoundItemObservation } from './found-item-observation.entity';
import { FoundItemReport } from './found-item-report.entity';
import { FoundItem, FoundItemStatus } from './found-item.entity';
import { FoundItemsService } from './found-items.service';

describe('Found-item audience-aware location privacy', () => {
  let service: FoundItemsService;
  let item: FoundItem;
  let query: { leftJoinAndSelect: jest.Mock; where: jest.Mock; andWhere: jest.Mock; orderBy: jest.Mock; getMany: jest.Mock };
  const foundItems = { createQueryBuilder: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn(), increment: jest.fn() };
  const claims = { createQueryBuilder: jest.fn(), find: jest.fn(), findOne: jest.fn(), save: jest.fn() };
  const reports = { create: jest.fn(), save: jest.fn() };
  const users = { findOne: jest.fn() };
  const gateway = { broadcastRescue: jest.fn() };
  const geocoding = { forwardGeocode: jest.fn(), reverseGeocode: jest.fn() };
  const gamification = { recordFoundItemPosted: jest.fn(), recordFoundItemPickedUp: jest.fn() };
  const owner = Object.assign(new User(), { id: 'owner-id', status: UserStatus.ACTIVE, postcode: 'E162RD' });
  const publicLocation = { latitude: 51.51, longitude: 0.07, postcode: 'E16', address: null,
    neighborhood: null, precision: 'approximate', approximateDistance: null };
  const assertPublic = (value: unknown) => expect(JSON.stringify(value)).not.toMatch(/2RD|PRIVATE_STREET|PRIVATE_NEIGHBORHOOD|51\.5077|0\.068/);

  beforeEach(async () => {
    jest.resetAllMocks();
    item = Object.assign(new FoundItem(), { id: 'spot-id', posterId: owner.id, poster: owner,
      title: 'Synthetic chair', description: 'Synthetic fixture', category: 'furniture', status: FoundItemStatus.AVAILABLE,
      images: [], postcode: 'E162RD', address: 'PRIVATE_STREET', neighborhood: 'PRIVATE_NEIGHBORHOOD',
      latitude: 51.5077, longitude: 0.068, viewCount: 0, estimatedCo2eKg: 12, impactPoints: 50,
      postedAt: new Date('2026-11-03T00:00:00Z'), expiresAt: null });
    query = { leftJoinAndSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([item]) };
    const counts = { select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(), groupBy: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([]) };
    foundItems.createQueryBuilder.mockReturnValue(query); foundItems.findOne.mockResolvedValue(item);
    foundItems.create.mockImplementation((entry: Partial<FoundItem>) => Object.assign(new FoundItem(), entry));
    foundItems.save.mockImplementation(async (entry: FoundItem) => Object.assign(entry, { id: entry.id ?? item.id, postedAt: entry.postedAt ?? item.postedAt }));
    claims.createQueryBuilder.mockReturnValue(counts); claims.find.mockResolvedValue([]); claims.findOne.mockResolvedValue(null);
    reports.create.mockImplementation((entry: Partial<FoundItemReport>) => entry);
    users.findOne.mockImplementation(async ({ where }: { where: { id: string } }) => Object.assign(new User(), { ...owner, id: where.id }));
    geocoding.forwardGeocode.mockResolvedValue({ latitude: 51.51, longitude: 0.07 });
    geocoding.reverseGeocode.mockResolvedValue({ latitude: item.latitude, longitude: item.longitude,
      postcode: item.postcode, address: item.address, neighborhood: item.neighborhood });
    const module = await Test.createTestingModule({ providers: [FoundItemsService,
      { provide: getRepositoryToken(FoundItemObservation), useValue: { find: jest.fn().mockResolvedValue([]) } },
      { provide: getRepositoryToken(FoundItem), useValue: foundItems }, { provide: getRepositoryToken(FoundItemClaim), useValue: claims },
      { provide: getRepositoryToken(FoundItemReport), useValue: reports }, { provide: getRepositoryToken(User), useValue: users },
      { provide: ItemGeocodingService, useValue: geocoding }, { provide: NotificationsService, useValue: {} },
      { provide: NotificationsGateway, useValue: gateway }, { provide: GamificationService, useValue: gamification },
    ] }).compile();
    Object.assign(foundItems, { manager: { transaction: async (callback: (manager: unknown) => Promise<unknown>) => callback({
      getRepository: (entity: unknown) => entity === FoundItem ? foundItems : entity === FoundItemClaim ? claims : entity === FoundItemReport ? reports : entity === User ? users : { find: jest.fn().mockResolvedValue([]) },
    }) } });
    service = module.get(FoundItemsService);
  });

  it.each(['unrelated-id', 'guest-shaped-service-call'])('returns public detail location to %s without changing claim access', async (viewer) => {
    const result = await service.getById(viewer, item.id);
    expect(result.item.location).toEqual(publicLocation); expect(result.claims).toEqual([]); assertPublic(result);
    expect(claims.find).not.toHaveBeenCalled();
  });
  it.each(Object.values(FoundItemClaimStatus))('does not grant exact location to a %s claimant', async (status) => {
    claims.findOne.mockResolvedValue({ id: 'claim-id', foundItemId: item.id, claimerId: 'claimant-id', status,
      createdAt: item.postedAt, message: 'Synthetic note' });
    const result = await service.getById('claimant-id', item.id);
    expect(result.item.location).toEqual(publicLocation); expect(result.claims).toEqual([]); assertPublic(result);
  });
  it.each(['detail', 'mine', 'create', 'status'])('preserves private owner location in %s', async (path) => {
    const result = path === 'detail' ? (await service.getById(owner.id, item.id)).item
      : path === 'mine' ? (await service.listMine(owner.id, {})).items[0]
        : path === 'status' ? (await service.updateStatus(owner.id, item.id, { status: FoundItemStatus.EXPIRED })).item
          : (await service.create(owner.id, { title: item.title, description: item.description, category: 'furniture',
            images: [], location: { latitude: item.latitude!, longitude: item.longitude!, postcode: item.postcode, address: item.address! } })).item;
    expect(result.location).toMatchObject({ latitude: item.latitude, longitude: item.longitude, postcode: item.postcode,
      address: item.address, neighborhood: item.neighborhood, precision: 'exact' });
  });
  it('uses only public centres for feed distance and inclusion, including an owner viewing their feed entry', async () => {
    const second = Object.assign(new FoundItem(), item, { id: 'second-id', latitude: 51.5199, longitude: 0.0799, postcode: 'E15 3AB' });
    item.latitude = 51.5001; item.longitude = 0.0601;
    query.getMany.mockResolvedValue([item, second]);
    const result = await service.list(owner.id, { lat: 51.51, lng: 0.07, maxDistance: 0.1, postcode: 'E162RD' });
    expect(result.items).toHaveLength(2); expect(result.items.map((entry) => entry.location.approximateDistance)).toEqual([0, 0]);
    expect(result.items.every((entry) => entry.location.precision === 'approximate')).toBe(true);
    expect(query.andWhere.mock.calls.flat().join(' ')).not.toMatch(/LIKE|UPPER\(item.postcode\)/);
    assertPublic(result);
  });
  it.each(['%', 'E16%', 'E16_', 'London E16', 'E162RD extra', ''])('rejects unsupported postcode filter %j before reading items', async (postcode) => {
    await expect(service.list('other', { postcode })).rejects.toBeInstanceOf(BadRequestException);
    expect(foundItems.createQueryBuilder).not.toHaveBeenCalled();
  });
  it('retains unavailable locations in the ordinary list without an invented zero point', async () => {
    item.latitude = null; item.longitude = null;
    const result = await service.list('other', {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0].location).toEqual({ ...publicLocation, latitude: null, longitude: null, precision: 'unavailable' });
  });
  it('does not silently broaden a distance search when the origin lookup fails', async () => {
    geocoding.forwardGeocode.mockRejectedValue(new Error('Synthetic offline'));
    await expect(service.list('other', { postcode: 'E16', maxDistance: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([{ maxDistance: 1 }, { sortBy: FoundItemSortBy.NEAREST }])('requires an origin for requested distance semantics %j', async (filter) => {
    await expect(service.list('other', filter)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('does not allow non-owners to update location/status through an existing status workflow', async () => {
    await expect(service.updateStatus('other', item.id, { status: FoundItemStatus.EXPIRED })).rejects.toBeInstanceOf(ForbiddenException);
    expect(foundItems.save).not.toHaveBeenCalled();
  });
  it('publishes outward-only postcode in the rescue event', async () => {
    await service.updateStatus(owner.id, item.id, { status: FoundItemStatus.PICKED_UP });
    expect(gateway.broadcastRescue.mock.calls[0][1].postcode).toBe('E16'); assertPublic(gateway.broadcastRescue.mock.calls);
  });
  it('never broadcasts an unverified report or its location', async () => {
    await service.report('reporter-id', item.id, { reason: 'already_gone' });
    expect(gateway.broadcastRescue).not.toHaveBeenCalled();
  });
  it('recent closed discovery is explicit and status filtering remains exact', async () => {
    await service.list('viewer', {includeRecentClosed:true});
    expect(query.where.mock.calls[0][0]).toContain('item.closed_at >= :closedSince');
    expect(query.where.mock.calls[0][1]).toMatchObject({activeStatuses:['available','claimed'],closedStatuses:['picked_up','gone','expired']});
    query.where.mockClear();
    await service.list('viewer', {includeRecentClosed:true,status:FoundItemStatus.CLAIMED});
    expect(query.where.mock.calls[0][0]).toBe('item.status = :status');
    expect(query.where.mock.calls[0][1].status).toBe(FoundItemStatus.CLAIMED);
  });

});
