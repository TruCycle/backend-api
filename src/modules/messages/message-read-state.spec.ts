import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EntityManager, Repository } from 'typeorm';

import { User } from '../users/user.entity';

import { ReadMessagesDto } from './dto/read-messages.dto';
import { INSERT_READ_RECEIPTS_SQL, UNREAD_COUNTS_SQL } from './message-read-state';
import { MessageRoom } from './message-room.entity';
import { Message } from './message.entity';
import { MessagesMediaService } from './messages-media.service';
import { MessagesPresenceService } from './messages-presence.service';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const outsider = '00000000-0000-4000-8000-000000000003';
const roomId = '00000000-0000-4000-8000-000000000004';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Serial transactions with rollback model application authorization, NOT actual
// PostgreSQL concurrency. Hosted/full-schema rehearsal verifies actual SQL/locks.
function fixture() {
  const room = { id: roomId, userOne: { id: a }, userTwo: { id: b }, deleted: false } as MessageRoom;
  const messages = new Map([[id(10), { room: roomId, sender: b, direct: true }],
    [id(11), { room: roomId, sender: b, direct: true }], [id(12), { room: roomId, sender: a, direct: true }],
    [id(13), { room: roomId, sender: b, direct: false }], [id(14), { room: id(5), sender: b, direct: true }]]);
  let receipts = new Set<string>(); let failCommit = false; let tail = Promise.resolve();
  const committed: string[] = [];
  const rooms = { findOne: jest.fn().mockResolvedValue(room), delete: jest.fn().mockResolvedValue({ affected: 1 }) };
  const messageRepository = { delete: jest.fn().mockResolvedValue({ affected: 2 }) };
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    const [viewer, requestedRoom, requestedIds] = params as [string, string | string[], string[]];
    if (sql === UNREAD_COUNTS_SQL) {
      const count = [...messages].filter(([messageId, row]) => (requestedRoom as string[]).includes(row.room) && row.direct && row.sender !== viewer && !receipts.has(viewer + messageId)).length;
      return count ? [{ roomId, count }] : [];
    }
    if (sql === INSERT_READ_RECEIPTS_SQL) {
      for (const messageId of requestedIds) {
        const row = messages.get(messageId);
        if (row?.room === requestedRoom && row.direct && row.sender !== viewer) receipts.add(viewer + messageId);
      }
      return [];
    }
    return requestedIds.filter(messageId => messages.get(messageId)?.room === requestedRoom).map(messageId => ({
      id: messageId, incoming: messages.get(messageId)!.direct && messages.get(messageId)!.sender !== viewer,
    }));
  });
  const manager = { query, getRepository: (entity: unknown) => entity === MessageRoom ? rooms : messageRepository,
    transaction: <T>(work: (tx: EntityManager) => Promise<T>) => {
      const task = tail.then(async () => { const previous = new Set(receipts);
        try { const result = await work(manager as unknown as EntityManager); if (failCommit) throw new Error('Synthetic commit failure'); committed.push('commit'); return result; }
        catch (error) { receipts = previous; throw error; } });
      tail = task.then(() => undefined, () => undefined); return task;
    } };
  const gateway = { emitReadState: jest.fn().mockImplementation(async () => { expect(committed.length).toBeGreaterThan(0); }),
    emitRoomCleared: jest.fn().mockResolvedValue(undefined), emitRoomDeleted: jest.fn().mockResolvedValue(undefined) };
  const service = new MessagesService(rooms as unknown as Repository<MessageRoom>, { manager, query } as unknown as Repository<Message>,
    {} as Repository<User>, {} as MessagesMediaService, {} as MessagesPresenceService, gateway as unknown as MessagesGateway);
  return { service, query, rooms, room, gateway, messages, receipts: () => receipts, failCommit: () => { failCommit = true; } };
}

describe('Explicit durable read acknowledgements', () => {
  it('records viewed incoming IDs only and retains unseen same-time/concurrent messages as unread', async () => {
    const f = fixture();
    expect(await f.service.acknowledgeRead(roomId, a, [id(10), id(12), id(13)])).toEqual({ readMessageIds: [id(10)], unreadCount: 1 });
    expect([...f.receipts()]).toEqual([a + id(10)]);
    expect(f.gateway.emitReadState).toHaveBeenCalledWith(a, roomId, 1);
    expect(f.rooms.findOne).toHaveBeenCalledWith(expect.objectContaining({ loadEagerRelations: false, lock: { mode: 'pessimistic_write' } }));
    f.messages.set(id(15), { room: roomId, sender: b, direct: true });
    expect((await f.service.acknowledgeRead(roomId, a, [id(10)])).unreadCount).toBe(2);
  });
  it('retries/concurrent acknowledgements retain one receipt and never acknowledge a different room', async () => {
    const f = fixture();
    await Promise.all([f.service.acknowledgeRead(roomId, a, [id(10)]), f.service.acknowledgeRead(roomId, a, [id(10)])]);
    expect(f.receipts().size).toBe(1);
    await expect(f.service.acknowledgeRead(roomId, a, [id(11), id(14)])).rejects.toBeInstanceOf(BadRequestException);
    expect(f.receipts().size).toBe(1);
  });
  it('rejects outsider before any message query or insert', async () => {
    const f = fixture(); await expect(f.service.acknowledgeRead(roomId, outsider, [id(10)])).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.query).not.toHaveBeenCalled(); expect(f.gateway.emitReadState).not.toHaveBeenCalled();
  });
  it('rejects deleted/missing rooms before message access', async () => {
    const f = fixture(); f.room.deleted = true;
    await expect(f.service.acknowledgeRead(roomId, a, [id(10)])).rejects.toBeInstanceOf(NotFoundException);
    f.rooms.findOne.mockResolvedValue(null);
    await expect(f.service.acknowledgeRead(roomId, a, [id(10)])).rejects.toBeInstanceOf(NotFoundException);
    expect(f.query).not.toHaveBeenCalled();
  });
  it('does not broadcast or retain a receipt after failed commit', async () => {
    const f = fixture(); f.failCommit();
    await expect(f.service.acknowledgeRead(roomId, a, [id(10)])).rejects.toThrow('Synthetic commit failure');
    expect(f.receipts().size).toBe(0); expect(f.gateway.emitReadState).not.toHaveBeenCalled();
  });
  it('locks clear/delete against concurrent read acknowledgement', async () => {
    const f = fixture(); await f.service.deleteRoomMessages(roomId, a); await f.service.deleteRoom(roomId, a);
    expect(f.rooms.findOne).toHaveBeenCalledTimes(2);
    for (const [options] of f.rooms.findOne.mock.calls) expect(options.lock.mode).toBe('pessimistic_write');
    expect(f.gateway.emitRoomCleared).toHaveBeenCalledWith(roomId, [a, b]);
    expect(f.gateway.emitRoomDeleted).toHaveBeenCalledWith(roomId, [a, b]);
  });
  it.each(['deleteRoomMessages', 'deleteRoom'] as const)('%s does not broadcast on denied access or a failed commit', async method => {
    const f = fixture();
    await expect(f.service[method](roomId, outsider)).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.gateway.emitRoomCleared).not.toHaveBeenCalled(); expect(f.gateway.emitRoomDeleted).not.toHaveBeenCalled();
    f.failCommit(); await expect(f.service[method](roomId, a)).rejects.toThrow('Synthetic commit failure');
    expect(f.gateway.emitRoomCleared).not.toHaveBeenCalled(); expect(f.gateway.emitRoomDeleted).not.toHaveBeenCalled();
  });
  it.each(['deleteRoomMessages', 'deleteRoom'] as const)('%s keeps committed success when live delivery fails', async method => {
    const f = fixture();
    f.gateway.emitRoomCleared.mockRejectedValue(new Error('Synthetic delivery failure'));
    f.gateway.emitRoomDeleted.mockRejectedValue(new Error('Synthetic delivery failure'));
    await expect(f.service[method](roomId, a)).resolves.toBeUndefined();
  });
  it.each([{ values: [] }, { values: ['bad'] }, { values: Array.from({ length: 101 }, () => id(10)) }])('rejects bounded invalid input before opening a transaction', async ({ values }) => {
    const f = fixture(); await expect(f.service.acknowledgeRead(roomId, a, values)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.rooms.findOne).not.toHaveBeenCalled();
  });
  it('validates DTO bounds and duplicates', async () => {
    expect(await validate(plainToInstance(ReadMessagesDto, { messageIds: [id(10)] }))).toEqual([]);
    for (const values of [[], [id(10), id(10)], ['bad'], Array.from({ length: 101 }, (_, n) => id(n + 10))]) {
      expect((await validate(plainToInstance(ReadMessagesDto, { messageIds: values }))).length).toBeGreaterThan(0);
    }
  });
});
