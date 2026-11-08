import { ForbiddenException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';

import { GamificationService } from '../gamification/gamification.service';
import { Item, ItemStatus } from '../items/item.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RewardsService } from '../rewards/rewards.service';
import { Shop } from '../shops/shop.entity';
import { RoleCode } from '../users/role.entity';
import { User, UserStatus } from '../users/user.entity';

import { Claim, ClaimStatus } from './claim.entity';
import { ClaimsService } from './claims.service';

function approvedExchange() {
  const donor = { id: 'donor', status: UserStatus.ACTIVE };
  const collector = { id: 'collector', status: UserStatus.ACTIVE };
  const outsider = { id: 'outsider', status: UserStatus.ACTIVE };
  const item = Object.assign(new Item(), {
    id: 'item', title: 'Bicycle', donor, approvedCollectorId: collector.id, status: ItemStatus.ACTIVE,
  });
  const claim = Object.assign(new Claim(), { id: 'claim', item, collector, status: ClaimStatus.APPROVED });
  const builder = {
    setLock: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    getOne: jest.fn(async () => claim),
  };
  const scanEvents: { scan_type: string; shop_id: string | null; scanned_at: Date }[] = [];
  const itemRepo = {
    update: jest.fn(async (_id: string, changes: Partial<Item>) => Object.assign(item, changes)),
  };
  const commit = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  const claimRepo = {
    createQueryBuilder: jest.fn(() => builder),
    save: jest.fn(async (row: Claim) => row),
    manager: {
      transaction: async (complete: (transaction: EntityManager) => Promise<unknown>) => {
        const result = await complete(manager);
        await commit();
        return result;
      },
    },
  };
  const manager = {
    getRepository(entity: typeof Claim | typeof Item) {
      return entity === Claim ? claimRepo : itemRepo;
    },
    async query(sql: string, parameters: [string, string, string | null, Date]) {
      if (sql.startsWith('INSERT INTO item_scan_event')) {
        const [, scanType, shopId, scannedAt] = parameters;
        scanEvents.push({ scan_type: scanType, shop_id: shopId, scanned_at: scannedAt });
        return [];
      }
      if (sql.startsWith('SELECT scan_type, shop_id, scanned_at FROM item_scan_event')) {
        return scanEvents;
      }
      throw new Error('Unexpected completion query');
    },
  } as unknown as EntityManager;
  const users = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      [donor, collector, outsider].find(actor => actor.id === where.id)),
  };
  const shops = { findOne: jest.fn().mockResolvedValue({ owner: { id: 'shop-owner' } }) };
  const notifications = {
    notifyItemCollected: jest.fn(),
    notifyDropOff: jest.fn(),
    notifyDropIn: jest.fn(),
  };
  const rewards = { awardOnClaimComplete: jest.fn() };
  const gamification = { recordExchangeCompleted: jest.fn() };
  const service = new ClaimsService(
    claimRepo as unknown as Repository<Claim>, itemRepo as unknown as Repository<Item>,
    users as unknown as Repository<User>, shops as unknown as Repository<Shop>,
    notifications as unknown as NotificationsService, rewards as unknown as RewardsService,
    gamification as unknown as GamificationService,
  );
  return { service, item, claim, claimRepo, itemRepo, scanEvents, rewards, notifications, gamification, commit, shops };
}

const auth = (sub: string) => ({ sub, roles: [RoleCode.CUSTOMER] });

describe('Manual completion of an assigned claim', () => {
  it.each([['donor', 'collector'], ['collector', 'donor']])(
    'lets the %s complete and the %s retry without duplicating side effects',
    async (initiator, retryActor) => {
      const { service, item, claim, claimRepo, itemRepo, scanEvents, rewards, notifications, gamification } = approvedExchange();

      const completion = await service.completeClaimOutManual(auth(initiator), item.id);
      const retry = await service.completeClaimOutManual(auth(retryActor), item.id);

      expect(completion).toMatchObject({ id: claim.id, status: ClaimStatus.COMPLETE, scan_result: 'completed' });
      expect(retry).toEqual({ ...completion, scan_result: 'already_completed' });
      expect(item.status).toBe(ItemStatus.COMPLETE);
      expect(claimRepo.save).toHaveBeenCalledTimes(1);
      expect(itemRepo.update).toHaveBeenCalledTimes(1);
      expect(scanEvents).toEqual([{ scan_type: 'CLAIM_OUT', shop_id: null, scanned_at: claim.completedAt }]);
      expect(rewards.awardOnClaimComplete).toHaveBeenCalledTimes(1);
      expect(gamification.recordExchangeCompleted).toHaveBeenCalledTimes(2);
      expect(notifications.notifyItemCollected).toHaveBeenCalledTimes(1);
    },
  );

  it('denies an unrelated customer before changing the claim or issuing rewards', async () => {
    const { service, item, claim, claimRepo, itemRepo, scanEvents, rewards, notifications, gamification } = approvedExchange();

    await expect(service.completeClaimOutManual(auth('outsider'), item.id)).rejects.toBeInstanceOf(ForbiddenException);

    expect(item.status).toBe(ItemStatus.ACTIVE);
    expect(claim.status).toBe(ClaimStatus.APPROVED);
    expect(claimRepo.save).not.toHaveBeenCalled();
    expect(itemRepo.update).not.toHaveBeenCalled();
    expect(scanEvents).toHaveLength(0);
    expect(rewards.awardOnClaimComplete).not.toHaveBeenCalled();
    expect(gamification.recordExchangeCompleted).not.toHaveBeenCalled();
    expect(notifications.notifyItemCollected).not.toHaveBeenCalled();
  });
});

describe.each(['completeClaimOutManual', 'completeClaimOut'] as const)('%s notifications', method => {
  it('notifies the parties after commit and skips notification on retry', async () => {
    const { service, item, commit, notifications, shops } = approvedExchange();
    item.dropoffLocationId = 'shop';
    commit.mockImplementationOnce(async () => {
      expect(notifications.notifyItemCollected).not.toHaveBeenCalled();
      expect(notifications.notifyDropOff).not.toHaveBeenCalled();
      expect(notifications.notifyDropIn).not.toHaveBeenCalled();
      expect(shops.findOne).not.toHaveBeenCalled();
    });

    const completed = await service[method](auth('collector'), item.id, 'shop');
    const retry = await service[method](auth('collector'), item.id, 'shop');

    expect(completed.scan_result).toBe('completed');
    expect(retry.scan_result).toBe('already_completed');
    expect(completed).not.toHaveProperty('completedClaim');
    expect(notifications.notifyItemCollected.mock.calls).toEqual([['donor', 'collector', item.id, item.title]]);
    expect(notifications.notifyDropOff.mock.calls).toEqual([['donor', item.id, item.title]]);
    expect(notifications.notifyDropIn.mock.calls).toEqual([['shop-owner', 'donor', item.id, item.title]]);
  });

  it('sends no notification when the transaction fails to commit', async () => {
    const { service, item, commit, notifications, shops } = approvedExchange();
    const commitError = new Error('commit failed');
    commit.mockRejectedValueOnce(commitError);

    await expect(service[method](auth('collector'), item.id, 'shop')).rejects.toBe(commitError);

    expect(notifications.notifyItemCollected).not.toHaveBeenCalled();
    expect(notifications.notifyDropOff).not.toHaveBeenCalled();
    expect(notifications.notifyDropIn).not.toHaveBeenCalled();
    expect(shops.findOne).not.toHaveBeenCalled();
  });

  it('returns the committed collection when the notification fails', async () => {
    const { service, item, notifications } = approvedExchange();
    notifications.notifyItemCollected.mockRejectedValueOnce(new Error('notification unavailable'));

    await expect(service[method](auth('collector'), item.id, 'shop')).resolves.toMatchObject({
      status: ClaimStatus.COMPLETE, scan_result: 'completed',
    });
  });
});
