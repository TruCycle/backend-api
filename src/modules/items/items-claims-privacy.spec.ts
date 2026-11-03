import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Claim, ClaimStatus } from '../claims/claim.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { QrImageService } from '../qr/qr-image.service';
import { UserReview } from '../reviews/user-review.entity';
import { Shop } from '../shops/shop.entity';
import { KycProfile } from '../users/kyc-profile.entity';
import { User, UserStatus } from '../users/user.entity';

import { Co2EstimationService } from './co2-estimation.service';
import { ItemGeocodingService } from './item-geocoding.service';
import { Item, ItemCondition, ItemPickupOption, ItemStatus } from './item.entity';
import { ItemsService } from './items.service';

describe('Public item claim privacy', () => {
  let service: ItemsService;
  let item: Item;
  let claims: Claim[];

  const itemRepo = { findOne: jest.fn(), query: jest.fn() };
  const claimRepo = { find: jest.fn(), findOne: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const kycRepo = { findOne: jest.fn() };
  const reviewQuery = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };
  const reviewRepo = { createQueryBuilder: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const owner = Object.assign(new User(), {
      id: 'owner-id',
      firstName: 'Listing',
      lastName: 'Owner',
      email: 'owner@example.test',
      status: UserStatus.ACTIVE,
    });
    item = Object.assign(new Item(), {
      id: 'item-id',
      donor: owner,
      title: 'Test chair',
      status: ItemStatus.ACTIVE,
      condition: ItemCondition.GOOD,
      category: 'furniture',
      pickupOption: ItemPickupOption.EXCHANGE,
      images: [],
      createdAt: new Date('2026-10-28T10:00:00Z'),
    });
    claims = ['claimant-id', 'other-claimant-id'].map((collectorId, index) =>
      Object.assign(new Claim(), {
        id: `claim-${index}`,
        item,
        collector: Object.assign(new User(), {
          id: collectorId,
          firstName: `Private-${index}`,
          lastName: 'Collector',
          profileImageUrl: `https://example.test/private-${index}.png`,
        }),
        status: ClaimStatus.PENDING_APPROVAL,
        createdAt: new Date('2026-10-28T11:00:00Z'),
        approvedAt: null,
        completedAt: null,
      }),
    );

    itemRepo.findOne.mockImplementation(async () => item);
    itemRepo.query.mockResolvedValue([]);
    claimRepo.find.mockResolvedValue(claims);
    claimRepo.findOne.mockResolvedValue(null);
    userRepo.findOne.mockResolvedValue(owner);
    kycRepo.findOne.mockResolvedValue(null);
    reviewRepo.createQueryBuilder.mockReturnValue(reviewQuery);
    reviewQuery.getRawOne.mockResolvedValue(undefined);

    // Mock repository tokens and outbound dependencies; never import AppModule or a DB connection.
    const moduleRef = await Test.createTestingModule({
      providers: [
        ItemsService,
        { provide: getRepositoryToken(Item), useValue: itemRepo },
        { provide: getRepositoryToken(Claim), useValue: claimRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(KycProfile), useValue: kycRepo },
        { provide: getRepositoryToken(UserReview), useValue: reviewRepo },
        { provide: getRepositoryToken(Shop), useValue: {} },
        { provide: ItemGeocodingService, useValue: {} },
        { provide: QrImageService, useValue: {} },
        { provide: Co2EstimationService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ItemsService);
  });

  it.each([undefined, '', 'unrelated-id'])('does not retrieve or expose collectors to viewer %s', async (viewerId) => {
    const result = await service.getPublicItem(item.id, viewerId);

    expect(result.claims).toEqual([]);
    expect(result.claim).toBeNull();
    expect(claimRepo.find).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('Private-');
    expect(JSON.stringify(result)).not.toContain('other-claimant-id');
  });

  it('preserves a claimant\'s own claim summary without exposing any collector identities', async () => {
    claimRepo.findOne.mockResolvedValue(claims[0]);

    const result = await service.getPublicItem(item.id, 'claimant-id');

    expect(claimRepo.findOne).toHaveBeenCalledWith({
      where: { item: { id: item.id }, collector: { id: 'claimant-id' } },
    });
    expect(result.claim).toEqual({
      status: ClaimStatus.PENDING_APPROVAL,
      requested_at: '2026-10-28T11:00:00.000Z',
      claimed_at: null,
    });
    expect(result.claims).toEqual([]);
    expect(claimRepo.find).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('Private-');
    expect(JSON.stringify(result)).not.toContain('other-claimant-id');
  });

  it('returns the unchanged collector claim records to the listing owner', async () => {
    const result = await service.getPublicItem(item.id, 'owner-id');

    expect(claimRepo.find).toHaveBeenCalledWith({
      where: { item: { id: item.id } }, relations: ['collector'],
    });
    expect(result.claims).toEqual(claims.map((claim) => ({
      id: claim.id,
      status: claim.status,
      requested_at: '2026-10-28T11:00:00.000Z',
      approved_at: null,
      completed_at: null,
      collector: {
        id: claim.collector.id,
        name: `${claim.collector.firstName} ${claim.collector.lastName}`,
        profile_image: claim.collector.profileImageUrl,
      },
    })));
  });

  it.each([undefined, 'unrelated-id', 'owner-id'])('keeps draft items private for viewer %s', async (viewerId) => {
    item.status = ItemStatus.DRAFT;

    await expect(service.getPublicItem(item.id, viewerId)).rejects.toBeInstanceOf(NotFoundException);
    expect(claimRepo.find).not.toHaveBeenCalled();
    expect(claimRepo.findOne).not.toHaveBeenCalled();
  });

  it('returns not found for an absent item before retrieving claims', async () => {
    itemRepo.findOne.mockResolvedValue(null);

    await expect(service.getPublicItem('missing-id', 'owner-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(claimRepo.find).not.toHaveBeenCalled();
    expect(claimRepo.findOne).not.toHaveBeenCalled();
  });
});
