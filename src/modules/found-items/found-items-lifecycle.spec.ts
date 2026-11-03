import { BadRequestException, ForbiddenException } from '@nestjs/common';
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

describe('Found-item lifecycle (isolated repositories and providers)', () => {
  let service: FoundItemsService;
  let item: FoundItem;
  let claim: FoundItemClaim;
  const items = { findOne: jest.fn(), save: jest.fn(), find: jest.fn(), update: jest.fn(), delete: jest.fn() };
  const claims = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
  const reports = { create: jest.fn(), save: jest.fn() };
  let observationRows: FoundItemObservation[] = [];
  const observations = { find: jest.fn(), upsert: jest.fn() };
  const notifications = { createAndEmit: jest.fn() };
  const gateway = { broadcastRescue: jest.fn() };
  const gamification = { recordFoundItemPickedUp: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    observationRows = [];
    observations.find.mockImplementation(async ({where}: {where: {kind?: string}}) => observationRows.filter(row => !where.kind || row.kind === where.kind));
    observations.upsert.mockImplementation(async (value: FoundItemObservation) => {
      observationRows = observationRows.filter(row => row.observerId !== value.observerId);
      observationRows.push(Object.assign(new FoundItemObservation(), value));
    });
    item = Object.assign(new FoundItem(), {
      id: 'synthetic-spot', posterId: 'owner', poster: { id: 'owner' },
      title: 'Synthetic chair', description: '', category: 'furniture', images: [],
      status: FoundItemStatus.AVAILABLE, postcode: 'E16 2RD', viewCount: 0,
      postedAt: new Date('2026-11-03T10:00:00Z'), lastSeenAt: new Date('2026-11-03T10:00:00Z'), latitude: 51.51, longitude: 0.07,
    });
    claim = Object.assign(new FoundItemClaim(), {
      id: 'synthetic-claim', foundItemId: item.id, claimerId: 'claimer', status: FoundItemClaimStatus.PENDING,
    });
    items.findOne.mockResolvedValue(item);
    items.save.mockImplementation(async (value: FoundItem) => value);
    claims.find.mockResolvedValue([]);
    claims.findOne.mockResolvedValue(claim);
    const query = { select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([]) };
    claims.createQueryBuilder.mockReturnValue(query);
    reports.create.mockImplementation((value: Partial<FoundItemReport>) => value);
    // No AppModule/env/DB/network; every injected dependency is an inert mock.
    const module = await Test.createTestingModule({ providers: [FoundItemsService,
      { provide: getRepositoryToken(FoundItemObservation), useValue: observations },
      { provide: getRepositoryToken(FoundItem), useValue: items },
      { provide: getRepositoryToken(FoundItemClaim), useValue: claims },
      { provide: getRepositoryToken(FoundItemReport), useValue: reports },
      { provide: getRepositoryToken(User), useValue: { findOne: jest.fn().mockResolvedValue({ id: 'claimer', status: UserStatus.ACTIVE }) } },
      { provide: ItemGeocodingService, useValue: {} },
      { provide: NotificationsService, useValue: notifications },
      { provide: NotificationsGateway, useValue: gateway },
      { provide: GamificationService, useValue: gamification },
    ] }).compile();
    Object.assign(items, { manager: { transaction: async (callback: (manager: unknown) => Promise<unknown>) => callback({
      getRepository: (entity: unknown) => entity === FoundItem ? items : entity === FoundItemClaim ? claims : entity === FoundItemReport ? reports : entity === User ? { findOne: jest.fn().mockResolvedValue({ id: 'claimer', status: UserStatus.ACTIVE }) } : observations,
    }) } });
    service = module.get(FoundItemsService);
  });

  it('sequential pickup retry emits rewards and public events once', async () => {
    await service.updateStatus('owner', item.id, { status: FoundItemStatus.PICKED_UP });
    await service.updateStatus('owner', item.id, { status: FoundItemStatus.PICKED_UP });
    expect(gamification.recordFoundItemPickedUp).toHaveBeenCalledTimes(1);
    expect(gateway.broadcastRescue).toHaveBeenCalledTimes(1);
  });
  it('cannot reopen a completed pickup for repeated reward cycles', async () => {
    item.status = FoundItemStatus.PICKED_UP;
    await expect(service.updateStatus('owner', item.id, { status: FoundItemStatus.AVAILABLE })).rejects.toBeInstanceOf(BadRequestException);
    expect(items.save).not.toHaveBeenCalled();
  });
  it('closing without pickup cancels active requests without rewards', async () => {
    claims.find.mockResolvedValue([claim]);
    await service.updateStatus('owner', item.id, { status: FoundItemStatus.EXPIRED });
    expect(claim.status).toBe(FoundItemClaimStatus.CANCELLED);
    expect(item.status).toBe(FoundItemStatus.EXPIRED);
    expect(gamification.recordFoundItemPickedUp).not.toHaveBeenCalled();
    expect(gateway.broadcastRescue).not.toHaveBeenCalled();
  });
  it('non-owner cannot close or delete a post', async () => {
    await expect(service.updateStatus('other', item.id, { status: FoundItemStatus.EXPIRED })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove('other', item.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(items.delete).not.toHaveBeenCalled();
  });
  it.each([FoundItemClaimStatus.PENDING, FoundItemClaimStatus.ACKNOWLEDGED])('blocks deletion with %s claims', async (status) => {
    claim.status = status; claims.find.mockResolvedValue([claim]);
    await expect(service.remove('owner', item.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(items.delete).not.toHaveBeenCalled();
  });
  it('allows explicit owner cleanup without active claims', async () => {
    await service.remove('owner', item.id);
    expect(items.delete).toHaveBeenCalledWith(item.id);
  });
  it('completed requests cannot be cancelled', async () => {
    claim.status = FoundItemClaimStatus.COMPLETED;
    await expect(service.cancelClaim('claimer', item.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(items.update).not.toHaveBeenCalled();
  });
  it('cancellation never unconditionally reopens a closed spot', async () => {
    item.status = FoundItemStatus.REPORTED;
    await service.cancelClaim('claimer', item.id);
    expect(items.update).toHaveBeenCalledWith({ id: item.id, status: FoundItemStatus.CLAIMED }, { status: FoundItemStatus.AVAILABLE });
  });
  it('acknowledged claims keep a claimed spot reserved', async () => {
    claims.find.mockResolvedValue([{ ...claim, id: 'other', status: FoundItemClaimStatus.ACKNOWLEDGED }]);
    await service.cancelClaim('claimer', item.id);
    expect(items.update).not.toHaveBeenCalled();
  });
  it('cancellation retries do nothing', async () => {
    claim.status = FoundItemClaimStatus.CANCELLED;
    await service.cancelClaim('claimer', item.id);
    expect(claims.save).not.toHaveBeenCalled(); expect(items.update).not.toHaveBeenCalled();
  });
  it.each(['already_gone', 'unsafe', 'duplicate'])('%s report is not flytip/pickup proof', async (reason) => {
    await service.report('claimer', item.id, { reason });
    expect(item.status).toBe(reason === 'already_gone' ? FoundItemStatus.AVAILABLE : FoundItemStatus.REPORTED);
    expect(reports.save).toHaveBeenCalledTimes(1);
    expect(gateway.broadcastRescue).not.toHaveBeenCalled();
    expect(gamification.recordFoundItemPickedUp).not.toHaveBeenCalled();
  });
  it('reports preserve a completed status and reject empty reasons', async () => {
    item.status = FoundItemStatus.PICKED_UP;
    await service.report('claimer', item.id, { reason: 'misleading' });
    expect(item.status).toBe(FoundItemStatus.PICKED_UP);
    await expect(service.report('claimer', item.id, { reason: '  ' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('not-there signal requires the current active claimant', async () => {
    claims.findOne.mockResolvedValue(null);
    await expect(service.report('other', item.id, { reason: 'not_there' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(reports.save).not.toHaveBeenCalled();
    claims.findOne.mockResolvedValue(claim);
    await service.report('claimer', item.id, { reason: 'not_there' });
    expect(gateway.broadcastRescue).not.toHaveBeenCalled();
  });
  it('two independent current nearby gone votes close without points; one account cannot duplicate votes', async () => {
    const origin = { latitude: 51.51, longitude: 0.07, kind: 'gone' as const };
    await service.observe('one', item.id, origin);
    await service.observe('one', item.id, origin);
    expect(item.status).toBe(FoundItemStatus.AVAILABLE);
    expect(observationRows).toHaveLength(1);
    await service.observe('two', item.id, origin);
    expect(item.status).toBe(FoundItemStatus.GONE);
    expect(item.closedAt).toBeInstanceOf(Date);
    expect(gamification.recordFoundItemPickedUp).not.toHaveBeenCalled();
    expect(gateway.broadcastRescue).not.toHaveBeenCalled();
    expect(observationRows.every(row => !('latitude' in row) && !('longitude' in row))).toBe(true);
  });
  it('acknowledged claimant can mark not-there without GPS and cancels other active claims', async () => {
    claim.status = FoundItemClaimStatus.ACKNOWLEDGED; claims.find.mockResolvedValue([claim]);
    await service.report('claimer', item.id, { reason: 'not_there' });
    expect(item.status).toBe(FoundItemStatus.GONE);
    expect(claim.status).toBe(FoundItemClaimStatus.CANCELLED);
  });
  it('pending claimant is not elevated above ordinary nearby observations', async () => {
    await expect(service.observe('claimer', item.id, {kind:'gone'})).rejects.toBeInstanceOf(ForbiddenException);
    expect(item.status).toBe(FoundItemStatus.AVAILABLE);
  });
  it.each([{latitude:0,longitude:0},{latitude:999,longitude:0},{}])('rejects distant/invalid/missing self-attested origin %j', async (origin) => {
    claims.findOne.mockResolvedValue(null);
    await expect(service.observe('other', item.id, {kind:'gone',...origin})).rejects.toBeInstanceOf(ForbiddenException);
    expect(observations.upsert).not.toHaveBeenCalled();
  });
  it('missing spot coordinates never grant ordinary observation eligibility', async () => {
    item.latitude = null; item.longitude = null; claims.findOne.mockResolvedValue(null);
    await expect(service.observe('other', item.id, {kind:'gone',latitude:51.51,longitude:0.07})).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('owner dispute resets expiry and invalidates previous votes without deleting history', async () => {
    const origin = {latitude:51.51,longitude:0.07,kind:'gone' as const};
    await service.observe('one', item.id, origin);
    item.status = FoundItemStatus.GONE;
    await service.reconfirm('owner', item.id);
    expect(item.status).toBe(FoundItemStatus.AVAILABLE);
    expect(item.expiresAt!.getTime()-item.lastSeenAt!.getTime()).toBe(7*24*3600000);
    expect(observationRows).toHaveLength(1);
    await service.observe('two', item.id, origin);
    expect(item.status).toBe(FoundItemStatus.AVAILABLE);
  });
  it('nearby still-there observation resets last seen and expiry', async () => {
    const before = item.lastSeenAt!.getTime();
    await service.observe('one', item.id, {kind:'still_there',latitude:51.51,longitude:0.07});
    expect(item.lastSeenAt!.getTime()).toBeGreaterThan(before);
    expect(item.expiryNudgedAt).toBeNull();
  });
  it.each([FoundItemStatus.PICKED_UP, FoundItemStatus.REPORTED])('owner cannot reconfirm %s', async status => {
    item.status=status;
    await expect(service.reconfirm('owner', item.id)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('unrelated users cannot reconfirm or acknowledge claims', async () => {
    await expect(service.reconfirm('other', item.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.acknowledgeClaim('other', item.id, claim.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('owner acknowledges only an active claim and retry is idempotent', async () => {
    item.status=FoundItemStatus.CLAIMED;
    await service.acknowledgeClaim('owner',item.id,claim.id);
    await service.acknowledgeClaim('owner',item.id,claim.id);
    expect(claim.status).toBe(FoundItemClaimStatus.ACKNOWLEDGED);
    expect(claims.save).toHaveBeenCalledTimes(1);
  });
  it('72h nudge occurs once; 7d expiry cancels active claims without pickup proof', async () => {
    item.lastSeenAt=new Date('2026-11-01T00:00:00Z'); item.expiresAt=new Date('2026-11-08T00:00:00Z');
    items.find.mockResolvedValue([item]); claims.find.mockResolvedValue([claim]);
    expect(await service.processLifecycle(new Date('2026-11-04T00:00:00Z'))).toEqual({nudged:1,expired:0});
    expect(await service.processLifecycle(new Date('2026-11-04T01:00:00Z'))).toEqual({nudged:0,expired:0});
    expect(notifications.createAndEmit).toHaveBeenCalledTimes(1);
    expect(await service.processLifecycle(new Date('2026-11-08T00:00:00Z'))).toEqual({nudged:0,expired:1});
    expect(item.status).toBe(FoundItemStatus.EXPIRED); expect(claim.status).toBe(FoundItemClaimStatus.CANCELLED);
    expect(gamification.recordFoundItemPickedUp).not.toHaveBeenCalled();
  });
  it('historical null confirmation/expiry remains unscheduled', async () => {
    item.lastSeenAt=null; item.expiresAt=null; items.find.mockResolvedValue([item]);
    expect(await service.processLifecycle()).toEqual({nudged:0,expired:0});
    expect(items.save).not.toHaveBeenCalled();
  });
  it('every mutation acquires the parent pessimistic lock before writes', async () => {
    await service.updateStatus('owner', item.id, {status:FoundItemStatus.GONE});
    expect(items.findOne.mock.calls[0][0]).toEqual({where:{id:item.id},lock:{mode:'pessimistic_write'}});
    expect(items.findOne.mock.invocationCallOrder[0]).toBeLessThan(items.save.mock.invocationCallOrder[0]);
  });

  it('concurrent close then claim cannot commit a late claim after closure (modelled transaction mutex)', async () => {
    let queue = Promise.resolve<unknown>(undefined);
    const manager = { getRepository: (entity: unknown) => entity === FoundItem ? items : entity === FoundItemClaim ? claims : entity === FoundItemReport ? reports : entity === User ? { findOne: async () => ({status:UserStatus.ACTIVE,id:'claimer'}) } : observations };
    Object.assign(items, {manager:{transaction: (operation: (value: typeof manager) => Promise<unknown>) => {
      const next = queue.then(() => operation(manager)); queue = next.catch(() => undefined); return next;
    }}});
    const result = await Promise.allSettled([
      service.updateStatus('owner',item.id,{status:FoundItemStatus.GONE}),
      service.claim('claimer',item.id,{}),
    ]);
    expect(result.map(row => row.status)).toEqual(['fulfilled','rejected']);
    expect(item.status).toBe(FoundItemStatus.GONE);
  });
  it('transaction commit failure never emits rewards or public announcements', async () => {
    const manager = { getRepository: (entity: unknown) => entity === FoundItem ? items : entity === FoundItemClaim ? claims : entity === FoundItemReport ? reports : entity === User ? {} : observations };
    Object.assign(items, {manager:{transaction: async (operation: (value: typeof manager) => Promise<unknown>) => {
      await operation(manager); throw new Error('Synthetic transaction commit rejected');
    }}});
    await expect(service.updateStatus('owner',item.id,{status:FoundItemStatus.PICKED_UP})).rejects.toThrow('commit rejected');
    expect(gamification.recordFoundItemPickedUp).not.toHaveBeenCalled();
    expect(gateway.broadcastRescue).not.toHaveBeenCalled();
  });
  it('GONE cannot become pickup proof without explicit reconfirmation', async () => {
    item.status=FoundItemStatus.GONE;
    await expect(service.updateStatus('owner',item.id,{status:FoundItemStatus.PICKED_UP})).rejects.toBeInstanceOf(BadRequestException);
    expect(gamification.recordFoundItemPickedUp).not.toHaveBeenCalled();
  });

});
