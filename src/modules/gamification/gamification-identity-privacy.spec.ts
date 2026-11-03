import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Claim } from '../claims/claim.entity';
import { FoundItemClaim } from '../found-items/found-item-claim.entity';
import { FoundItem, FoundItemStatus } from '../found-items/found-item.entity';
import { Item } from '../items/item.entity';
import { User } from '../users/user.entity';

import { GamificationBadge } from './badge.entity';
import { GamificationService } from './gamification.service';
import { PointTransaction } from './point-transaction.entity';
import { UserBadge } from './user-badge.entity';
import { UserProgress } from './user-progress.entity';
import { UserStreak } from './user-streak.entity';

function queryMock() {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(), getMany: jest.fn(), getCount: jest.fn(),
  };
}

describe.each(['named', 'email-only', 'missing relation'])('Board identity privacy: %s', (profile) => {
  let service: GamificationService;
  let boardQuery: ReturnType<typeof queryMock>;
  let progressQuery: ReturnType<typeof queryMock>;
  let user: User | undefined;
  const users = { findOne: jest.fn() };
  const foundItems = { createQueryBuilder: jest.fn() };
  const progress = { createQueryBuilder: jest.fn(), findOne: jest.fn() };

  function assertPrivateIdentityAbsent(value: unknown) {
    expect(JSON.stringify(value)).not.toMatch(/PRIVATE_FIRST|PRIVATE_LAST|private-email/);
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    user = profile === 'missing relation' ? undefined : Object.assign(new User(), {
      id: 'member-a', firstName: profile === 'named' ? 'PRIVATE_FIRST' : null,
      lastName: profile === 'named' ? 'PRIVATE_LAST' : null,
      email: 'private-email@example.test', postcode: 'E16 2RD',
    });
    users.findOne.mockResolvedValue({ id: 'viewer-id', postcode: 'E16 2RD' });
    boardQuery = queryMock(); progressQuery = queryMock();
    foundItems.createQueryBuilder.mockReturnValue(boardQuery);
    progress.createQueryBuilder.mockReturnValue(progressQuery);
    progress.findOne.mockResolvedValue(null);
    const moduleRef = await Test.createTestingModule({ providers: [
      GamificationService,
      { provide: getRepositoryToken(User), useValue: users },
      { provide: getRepositoryToken(FoundItem), useValue: foundItems },
      { provide: getRepositoryToken(UserProgress), useValue: progress },
      ...[Claim, Item, FoundItemClaim, UserStreak, GamificationBadge, UserBadge, PointTransaction]
        .map((entity) => ({ provide: getRepositoryToken(entity), useValue: {} })),
    ] }).compile();
    service = moduleRef.get(GamificationService);
    // This tranche tests projections, not the pre-existing write-on-read backfill.
    // No EntityManager or real repository is available in this fixture.
    jest.spyOn(service as unknown as { backfillAndSync(id: string): Promise<void> }, 'backfillAndSync')
      .mockResolvedValue(undefined);
  });

  it('neutralises community spotters, preserves totals and deterministically orders tied IDs', async () => {
    boardQuery.getMany.mockResolvedValue([
      { posterId: 'member-z', poster: user, postcode: 'E16 2RD', status: FoundItemStatus.AVAILABLE,
        impactPoints: 50, estimatedCo2eKg: 3 },
      { posterId: 'member-a', poster: user, postcode: 'E16 2RD', status: FoundItemStatus.PICKED_UP,
        impactPoints: 50, estimatedCo2eKg: 5 },
    ]);
    const result = await service.getCommunityBoard('viewer-id', 'month');
    expect(result.localSpotters.map(({ userId, name }) => ({ userId, name }))).toEqual([
      { userId: 'member-a', name: 'Community member' },
      { userId: 'member-z', name: 'Community member' },
    ]);
    expect(result.postcodes).toEqual([{ postcode: 'E16', spots: 2, rescues: 1,
      activeSpots: 1, totalCo2eKg: 5, impactPoints: 100 }]);
    expect(result.activeArea).toBe('E16');
    expect(boardQuery.where).toHaveBeenCalledWith('item.posted_at >= :startAt', { startAt: expect.any(Date) });
    expect(boardQuery.leftJoinAndSelect).not.toHaveBeenCalled();
    assertPrivateIdentityAbsent(result);
  });

  it('keeps self ranking and points while neutralising leaderboard labels', async () => {
    progressQuery.getCount.mockResolvedValue(12);
    progressQuery.getMany.mockResolvedValue([
      { userId: 'other-id', user, totalPoints: 500, currentLevel: 3 },
      { userId: 'viewer-id', user, totalPoints: 400, currentLevel: 2 },
    ]);
    const result = await service.getIndividualLeaderboard('viewer-id', { offset: 2, limit: 2 });
    expect(result.entries.map(({ name, rank, totalPoints, isCurrentUser }) =>
      ({ name, rank, totalPoints, isCurrentUser }))).toEqual([
      { name: 'Community member', rank: 3, totalPoints: 500, isCurrentUser: false },
      { name: 'Community member', rank: 4, totalPoints: 400, isCurrentUser: true },
    ]);
    expect(result.currentUser).toEqual(result.entries[1]);
    expect(result.total).toBe(12);
    expect(progress.findOne).not.toHaveBeenCalled();
    expect(progressQuery.skip).toHaveBeenCalledWith(2);
    expect(progressQuery.take).toHaveBeenCalledWith(2);
    assertPrivateIdentityAbsent(result);
  });

  it('neutralises the current-user label when outside the displayed page', async () => {
    progressQuery.getMany.mockResolvedValue([]);
    progressQuery.getCount.mockResolvedValueOnce(12).mockResolvedValueOnce(7);
    progress.findOne.mockResolvedValue({ userId: 'viewer-id', user, totalPoints: 300, currentLevel: 2 });
    const result = await service.getIndividualLeaderboard('viewer-id');
    expect(result.currentUser).toMatchObject({ userId: 'viewer-id', name: 'Community member',
      rank: 8, totalPoints: 300, currentLevel: 2, isCurrentUser: true });
    assertPrivateIdentityAbsent(result);
  });

  it('keeps an empty all-time board empty without applying a date filter', async () => {
    boardQuery.getMany.mockResolvedValue([]);
    const result = await service.getCommunityBoard('viewer-id', 'all');
    expect(result.localSpotters).toEqual([]);
    expect(result.postcodes).toEqual([]);
    expect(result.activeArea).toBeNull();
    expect(boardQuery.where).not.toHaveBeenCalled();
  });

  it('counts only completed pickups as estimated impact, never live/gone/expired stock', async () => {
    boardQuery.getMany.mockResolvedValue([
      ...[FoundItemStatus.AVAILABLE, FoundItemStatus.GONE, FoundItemStatus.EXPIRED]
        .map(status => ({ id: status, posterId: 'viewer-id', postcode: 'E16', status, estimatedCo2eKg: 100, postedAt: new Date() })),
      { id: 'pickup', posterId: 'viewer-id', postcode: 'E16', status: FoundItemStatus.PICKED_UP, estimatedCo2eKg: 5, postedAt: new Date() },
    ]);
    const summary = await service.getFoundItemImpact('viewer-id');
    expect(summary.totalCo2eKg).toBe(5);
    expect(summary.rescuedSpots).toBe(1);
  });

  it('does not disguise a missing completed-item estimate as zero or a complete total', async () => {
    boardQuery.getMany.mockResolvedValue([
      { id: 'known', posterId: 'viewer-id', postcode: 'E16', status: FoundItemStatus.PICKED_UP, estimatedCo2eKg: 5, postedAt: new Date() },
      { id: 'unknown', posterId: 'viewer-id', postcode: 'E16', status: FoundItemStatus.PICKED_UP, estimatedCo2eKg: null, postedAt: new Date() },
    ]);
    expect((await service.getFoundItemImpact('viewer-id')).totalCo2eKg).toBeNull();
  });

  it.each([
    ['e162rd', 'E16'], ['E16 2RD', 'E16'], ['34 Abbey Road E162RD', null],
  ])('projects persisted community postcode %j without exposing its inward/address part', async (postcode, area) => {
    users.findOne.mockResolvedValue({ id: 'viewer-id', postcode });
    boardQuery.getMany.mockResolvedValue([{ posterId: 'viewer-id', postcode,
      status: FoundItemStatus.AVAILABLE, impactPoints: 50, estimatedCo2eKg: 3 }]);
    const result = await service.getCommunityBoard('viewer-id', 'all');
    expect(result.userArea).toBe(area);
    expect(result.activeArea).toBe(area);
    expect(result.localSpotters[0].postcode).toBe(area);
    expect(result.postcodes).toEqual(area ? [{ postcode: area, spots: 1, rescues: 0,
      activeSpots: 1, totalCo2eKg: 0, impactPoints: 50 }] : []);
    expect(JSON.stringify(result)).not.toMatch(/2RD|Abbey Road/i);
  });

  it.each([
    ['ec1a1hq', 'EC1A'], ['EC1A 1HQ', 'EC1A'], ['EC1A1HQ London', null],
  ])('projects leaderboard and off-page self postcode %j to area only', async (postcode, area) => {
    const profileWithPostcode = { ...(user ?? {}), postcode };
    progressQuery.getMany.mockResolvedValue([
      { userId: 'other-id', user: profileWithPostcode, totalPoints: 500, currentLevel: 3 },
    ]);
    progressQuery.getCount.mockResolvedValue(1);
    progress.findOne.mockResolvedValue({ userId: 'viewer-id', user: profileWithPostcode,
      totalPoints: 300, currentLevel: 2 });
    const result = await service.getIndividualLeaderboard('viewer-id');
    expect(result.entries[0].postcode).toBe(area);
    expect(result.currentUser!.postcode).toBe(area);
    expect(JSON.stringify(result)).not.toMatch(/1HQ|London/i);
  });
});
