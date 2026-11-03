import { sessionAccessStub } from '../../testing/session-access-stub.test-support';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';

import { User } from '../users/user.entity';

import { Notification } from './notification.entity';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

describe('Generated nearby notification output and history privacy', () => {
  const rows = { create: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
  const users = { findOne: jest.fn() };
  const gateway = { emitToUser: jest.fn() };
  let service: NotificationsService;
  beforeEach(() => {
    jest.resetAllMocks();
    users.findOne.mockResolvedValue({ id: 'recipient' });
    rows.create.mockImplementation((value) => ({ ...value, id: 'notification', createdAt: new Date() }));
    rows.save.mockImplementation(async (value) => value);
    service = new NotificationsService(rows as unknown as Repository<Notification>, users as unknown as Repository<User>, gateway as unknown as NotificationsGateway);
  });
  it('persists and emits outward-only body and metadata with explicit generated provenance', async () => {
    await service.notifyNearbyItem('recipient', 'item', 'Chair', 'e162rd');
    const persisted = rows.create.mock.calls[0][0];
    expect(persisted).toMatchObject({ type: 'item.nearby', data: { source: 'nearby-item-v1', itemPostcode: 'E16', locationPrecision: 'approximate' } });
    expect(persisted.body).toContain('Approximate area: E16.');
    expect(JSON.stringify(persisted)).not.toMatch(/2RD/i);
    expect(gateway.emitToUser).toHaveBeenCalledWith('recipient', expect.objectContaining({ type: 'item.nearby', data: persisted.data, body: persisted.body }));
  });
  it('projects only explicitly generated history at read time without mutating the stored row', () => {
    const row = Object.assign(new Notification(), { id: 'old', type: 'item.nearby', title: 'old title', body: 'PRIVATE_OLD_BODY',
      data: { source: 'nearby-item-v1', itemId: 'item', itemTitle: 'Chair', itemPostcode: 'E16 2RD', privateAddress: 'PRIVATE_OLD_ADDRESS' } });
    const before = JSON.stringify(row);
    const view = service.view(row);
    expect(view.body).toContain('Approximate area: E16.');
    expect(view.data?.itemPostcode).toBe('E16');
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE_OLD|2RD/);
    expect(JSON.stringify(row)).toBe(before);
  });
  it('projects generated rows through actual user-scoped history listing without rewriting unmarked content', async () => {
    const generated = Object.assign(new Notification(), { id: 'generated', type: 'item.nearby', title: 'Old generated title', body: 'PRIVATE_OLD_BODY',
      data: { source: 'nearby-item-v1', itemId: 'item', itemTitle: 'Chair', itemPostcode: 'E16 2RD' } });
    const personal = Object.assign(new Notification(), { id: 'personal', type: 'general', title: 'Personal note', body: 'User text with E16 2RD' });
    const where = jest.fn().mockReturnThis();
    const query = { leftJoinAndSelect: jest.fn().mockReturnThis(), where, orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([generated, personal]) };
    rows.createQueryBuilder.mockReturnValue(query);
    const values = await service.listForUser('recipient');
    expect(where).toHaveBeenCalledWith('user.id = :userId', { userId: 'recipient' });
    expect(values[0].body).toContain('Approximate area: E16.');
    expect(values[0].data?.itemPostcode).toBe('E16');
    expect(values[1].body).toBe(personal.body);
    expect(generated.body).toBe('PRIVATE_OLD_BODY');
    expect(rows.save).not.toHaveBeenCalled();
  });

  it.each([
    { type: 'general', data: { itemId: 'item', itemPostcode: 'E16 2RD' } },
    { type: 'item.nearby', data: { itemId: 'item', itemPostcode: 'E16 2RD' } },
    { type: 'general', data: { source: 'nearby-item-v1', itemId: 'item' } },
  ])('preserves unmarked legacy/user-authored history %j for separate review', (fields) => {
    const row = Object.assign(new Notification(), { id: 'history', title: 'Personal note', body: 'User text with E16 2RD', ...fields });
    expect(service.view(row)).toMatchObject({ title: row.title, body: row.body, data: row.data });
  });
});


describe('Defensive rescue broadcast postcode projection', () => {
  it.each(['rescue', 'flytip'] as const)('projects %s postcode even when a caller passes a full code', async (kind) => {
    const emit = jest.fn();
    const gateway = new NotificationsGateway({} as JwtService, {} as NotificationsService, {} as Repository<User>, sessionAccessStub());
    jest.spyOn((gateway as unknown as { access: { authorizedIds(): Promise<string[]> } }).access, 'authorizedIds').mockResolvedValue(['synthetic-recipient']);
    Object.defineProperty(gateway, 'server', { value: { to: jest.fn().mockReturnValue({ emit }) } });
    const payload = { id: 'found', title: 'Chair', postcode: 'E16 2RD', impactPoints: 5 };
    await gateway.broadcastRescue(kind, payload);
    expect(emit).toHaveBeenCalledWith(kind === 'rescue' ? 'rescue:new' : 'rescue:flytip', expect.objectContaining({
      id: 'found', title: 'Chair', postcode: 'E16', impactPoints: 5, ts: expect.any(String),
    }));
    expect(JSON.stringify(emit.mock.calls)).not.toContain('2RD');
    expect(payload.postcode).toBe('E16 2RD');
  });
});
