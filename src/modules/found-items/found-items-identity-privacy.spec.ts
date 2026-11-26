import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { GamificationService } from '../gamification/gamification.service';
import { ItemGeocodingService } from '../items/item-geocoding.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { User, UserStatus } from '../users/user.entity';

import { FoundItemClaim, FoundItemClaimStatus } from './found-item-claim.entity';
import { FoundItemObservation } from './found-item-observation.entity';
import { FoundItemReport } from './found-item-report.entity';
import { FoundItem, FoundItemStatus } from './found-item.entity';
import { FoundItemsService } from './found-items.service';

describe.each(['real names', 'email fallback'])('Found-item identity privacy with %s', (profile) => {
  let service: FoundItemsService;
  let poster: User;
  let claimer: User;
  let item: FoundItem;
  let claim: FoundItemClaim;

  const foundItems = {
    createQueryBuilder: jest.fn(), findOne: jest.fn(), save: jest.fn(), increment: jest.fn(),
  };
  const claims = {
    createQueryBuilder: jest.fn(), find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn(),
  };
  const reports = { create: jest.fn(), save: jest.fn() };
  const users = { findOne: jest.fn() };
  const notifications = { createAndEmit: jest.fn() };
  const gateway = { broadcastRescue: jest.fn() };
  const gamification = {
    recordFoundItemClaimed: jest.fn(), recordFoundItemPickedUp: jest.fn(),
  };

  function assertNoPrivateIdentity(value: unknown) {
    const serialized = JSON.stringify(value);
    for (const sentinel of ['POSTER_PRIVATE', 'CLAIMER_PRIVATE', 'PRIVATE_SURNAME', 'poster-email-sentinel', 'claimer-email-sentinel']) {
      expect(serialized).not.toContain(sentinel);
    }
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    poster = Object.assign(new User(), {
      id: 'poster-id',
      firstName: profile === 'real names' ? 'POSTER_PRIVATE' : null,
      lastName: profile === 'real names' ? 'PRIVATE_SURNAME' : null,
      email: 'poster-email-sentinel@example.test',
      profileImageUrl: 'https://example.test/poster-avatar.png',
      status: UserStatus.ACTIVE,
    });
    claimer = Object.assign(new User(), {
      id: 'claimer-id',
      firstName: profile === 'real names' ? 'CLAIMER_PRIVATE' : null,
      lastName: profile === 'real names' ? 'PRIVATE_SURNAME' : null,
      email: 'claimer-email-sentinel@example.test',
      status: UserStatus.ACTIVE,
    });
    item = Object.assign(new FoundItem(), {
      id: 'spot-id', posterId: poster.id, poster,
      title: 'Test chair', description: 'Synthetic test item', category: 'furniture',
      status: FoundItemStatus.AVAILABLE, images: [],
      postcode: 'E16 2RD', address: 'Synthetic owner address', neighborhood: 'Synthetic area',
      latitude: 51.5077, longitude: 0.068, viewCount: 0,
      estimatedCo2eKg: 12, impactPoints: 24,
      postedAt: new Date('2026-11-02T10:00:00Z'),
    });
    claim = Object.assign(new FoundItemClaim(), {
      id: 'claim-id', foundItemId: item.id, foundItem: item,
      claimerId: claimer.id, claimer, message: 'Synthetic pickup note',
      status: FoundItemClaimStatus.PENDING,
      createdAt: new Date('2026-11-02T11:00:00Z'),
    });

    const itemQuery = {
      leftJoinAndSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([item]),
    };
    const claimQuery = {
      select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([]),
    };
    foundItems.createQueryBuilder.mockReturnValue(itemQuery);
    foundItems.findOne.mockResolvedValue(item);
    foundItems.save.mockImplementation(async (entry: FoundItem) => entry);
    claims.createQueryBuilder.mockReturnValue(claimQuery);
    claims.find.mockResolvedValue([]);
    claims.findOne.mockResolvedValue(null);
    claims.create.mockImplementation((entry: Partial<FoundItemClaim>) => Object.assign(new FoundItemClaim(), entry));
    claims.save.mockImplementation(async (entry: FoundItemClaim) => Object.assign(entry, {
      id: entry.id ?? claim.id, createdAt: entry.createdAt ?? claim.createdAt,
    }));
    users.findOne.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === poster.id ? poster : where.id === claimer.id ? claimer : null,
    );
    reports.create.mockImplementation((entry: Partial<FoundItemReport>) => Object.assign(new FoundItemReport(), entry));

    // No AppModule, database connection, geocoder or outbound service is bootstrapped.
    const moduleRef = await Test.createTestingModule({
      providers: [
        FoundItemsService,
        { provide: getRepositoryToken(FoundItemObservation), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(FoundItem), useValue: foundItems },
        { provide: getRepositoryToken(FoundItemClaim), useValue: claims },
        { provide: getRepositoryToken(FoundItemReport), useValue: reports },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: ItemGeocodingService, useValue: {} },
        { provide: NotificationsService, useValue: notifications },
        { provide: NotificationsGateway, useValue: gateway },
        { provide: GamificationService, useValue: gamification },
      ],
    }).compile();
    Object.assign(foundItems, { manager: { transaction: async (callback: (manager: unknown) => Promise<unknown>) => callback({
      getRepository: (entity: unknown) => entity === FoundItem ? foundItems : entity === FoundItemClaim ? claims : entity === FoundItemReport ? reports : entity === User ? users : { find: jest.fn().mockResolvedValue([]) },
    }) } });
    service = moduleRef.get(FoundItemsService);
  });

  it.each(['list', 'listMine'] as const)('uses a neutral poster label in %s and preserves IDs/avatar/location', async (method) => {
    const result = await service[method](method === 'listMine' ? poster.id : 'other-viewer-id', {});

    expect(result.items[0].poster).toEqual({
      id: poster.id, name: 'Community member', avatarUrl: poster.profileImageUrl,
    });
    expect(result.items[0].location).toEqual(method === 'listMine' ? {
      latitude: item.latitude, longitude: item.longitude, address: item.address,
      neighborhood: item.neighborhood, postcode: item.postcode, approximateDistance: null, precision: 'exact',
    } : { latitude: 51.51, longitude: 0.07, address: null, neighborhood: null,
      postcode: 'E16', approximateDistance: null, precision: 'approximate' });
    assertNoPrivateIdentity(result);
  });

  it('keeps all claimant records owner-only while neutralising their labels', async () => {
    claims.find.mockResolvedValue([claim]);
    const result = await service.getById(poster.id, item.id);

    expect(result.claims).toEqual([{
      id: claim.id, foundItemId: item.id, claimerId: claimer.id,
      claimerName: 'Community member', message: claim.message,
      status: claim.status, createdAt: claim.createdAt.toISOString(),
    }]);
    expect(result.item.poster.name).toBe('Community member');
    expect(result.viewerClaim).toBeNull();
    expect(claims.findOne).not.toHaveBeenCalled();
    assertNoPrivateIdentity(result);
  });

  it('returns only the current claimant summary to a non-owner', async () => {
    claims.findOne.mockResolvedValue(claim);
    const result = await service.getById(claimer.id, item.id);

    expect(claims.find).not.toHaveBeenCalled();
    expect(claims.findOne).toHaveBeenCalledWith({
      where: { foundItemId: item.id, claimerId: claimer.id },
      relations: { claimer: true }, order: { createdAt: 'DESC' },
    });
    expect(result.claims).toEqual([]);
    expect(result.viewerClaim).toMatchObject({ id: claim.id, claimerId: claimer.id, claimerName: 'Community member' });
    assertNoPrivateIdentity(result);
  });

  it('does not retrieve other claimant identities for an unrelated viewer', async () => {
    const result = await service.getById('unrelated-viewer-id', item.id);

    expect(claims.find).not.toHaveBeenCalled();
    expect(claims.findOne).toHaveBeenCalledWith({
      where: { foundItemId: item.id, claimerId: 'unrelated-viewer-id' },
      relations: { claimer: true }, order: { createdAt: 'DESC' },
    });
    expect(result.claims).toEqual([]);
    expect(result.viewerClaim).toBeNull();
    expect(result.item.poster.name).toBe('Community member');
    assertNoPrivateIdentity(result);
  });

  it('neutralises both the new claim response and the emitted interest notification', async () => {
    const result = await service.claim(claimer.id, item.id, { message: 'Synthetic pickup note' });

    expect(result.claim).toMatchObject({
      id: claim.id, foundItemId: item.id, claimerId: claimer.id,
      claimerName: 'Community member', message: 'Synthetic pickup note',
    });
    expect(notifications.createAndEmit).toHaveBeenCalledWith(
      poster.id, 'general', 'Found item interest',
      'Community member wants to pick up “Test chair”.',
      { foundItemId: item.id, claimId: claim.id },
    );
    expect(claims.create).toHaveBeenCalledWith(expect.objectContaining({ claimerId: claimer.id, claimer }));
    assertNoPrivateIdentity(result);
    assertNoPrivateIdentity(notifications.createAndEmit.mock.calls);
  });

  it('neutralises the rescue broadcast without changing its item/location/impact fields', async () => {
    await service.updateStatus(poster.id, item.id, { status: FoundItemStatus.PICKED_UP });

    expect(gateway.broadcastRescue).toHaveBeenCalledWith('rescue', {
      id: item.id, title: item.title, category: item.category, postcode: 'E16',
      co2eKg: item.estimatedCo2eKg, impactPoints: item.impactPoints,
      rescuerName: 'Community member', imageUrl: null,
    });
    expect(item.status).toBe(FoundItemStatus.PICKED_UP);
    assertNoPrivateIdentity(gateway.broadcastRescue.mock.calls);
  });

  it('retains the reporter privately without broadcasting an unverified report', async () => {
    const result = await service.report(claimer.id, item.id, { reason: 'other' });

    expect(result).toEqual({ success: true });
    expect(reports.create).toHaveBeenCalledWith(expect.objectContaining({ reporterId: claimer.id, reporter: claimer }));
    expect(gateway.broadcastRescue).not.toHaveBeenCalled();
    assertNoPrivateIdentity(gateway.broadcastRescue.mock.calls);
  });

  it('still rejects status changes by a non-owner', async () => {
    await expect(service.updateStatus(claimer.id, item.id, { status: FoundItemStatus.PICKED_UP }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(foundItems.save).not.toHaveBeenCalled();
    expect(gateway.broadcastRescue).not.toHaveBeenCalled();
  });

  it('still rejects the owner claiming their own item', async () => {
    await expect(service.claim(poster.id, item.id, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(claims.save).not.toHaveBeenCalled();
    expect(notifications.createAndEmit).not.toHaveBeenCalled();
  });

  it('still rejects inactive users before creating a claim', async () => {
    claimer.status = UserStatus.SUSPENDED;
    await expect(service.claim(claimer.id, item.id, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(claims.save).not.toHaveBeenCalled();
    expect(notifications.createAndEmit).not.toHaveBeenCalled();
  });
});
