import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, type EntityManager, type Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role.entity';
import { Role } from '../users/role.entity';
import { KycProfile } from '../users/kyc-profile.entity';
import { DirectMessageDto } from './dto/direct-message.dto';
import { MessageRoom } from './message-room.entity';
import { Message, MessageCategory } from './message.entity';
import { MessagesService } from './messages.service';
import { MessagesMediaService } from './messages-media.service';
import { MessagesPresenceService } from './messages-presence.service';
import { MessagesGateway } from './messages.gateway';

const id = '00000000-0000-4000-8000-000000000001';
// Synthetic serial transactions with rollback; NOT actual PostgreSQL lock proof.
function fixture() {
  const room = { id: 'room-a', userOne: { id: 'a' }, userTwo: { id: 'b' }, deleted: false } as MessageRoom;
  let rows = new Map<string, Message>(); let tail = Promise.resolve(); let failCommit = false;
  const events: string[] = []; const gateway = { broadcastMessage: jest.fn() };
  const rooms = { findOne: jest.fn().mockResolvedValue(room), update: jest.fn().mockResolvedValue({ affected: 1 }) };
  const repository = { createQueryBuilder: jest.fn(), findOneOrFail: jest.fn(async ({ where }: { where: { id: string } }) => {
    const value = rows.get(where.id); if (!value) throw Error('Synthetic missing row'); return value;
  }) };
  repository.createQueryBuilder.mockImplementation(() => {
    let value: Message;
    const query = { insert: () => query, values: (input: Message) => { value = input; return query; }, orIgnore: () => query, returning: () => query,
      execute: async () => { events.push('insert'); if (rows.has(value.id)) return { raw: [] };
        rows.set(value.id, { ...value, createdAt: new Date('2026-11-03T10:00:00Z') }); return { raw: [{ id: value.id }] }; } };
    return query;
  });
  const manager = { getRepository: (target: unknown) => target === MessageRoom ? rooms : repository,
    transaction: <T>(work: (tx: EntityManager) => Promise<T>) => {
      const current = tail.then(async () => { const snapshot = structuredClone(rows); events.push('begin');
        try { const result = await work(manager as unknown as EntityManager); if (failCommit) throw Error('Synthetic private commit failure'); events.push('commit'); return result; }
        catch (error) { rows = snapshot; events.push('rollback'); throw error; } });
      tail = current.then(() => undefined, () => undefined); return current;
    } };
  Object.assign(repository, { manager });
  const service = new MessagesService(rooms as unknown as Repository<MessageRoom>, repository as unknown as Repository<Message>, {} as Repository<User>, {} as MessagesMediaService, {} as MessagesPresenceService, gateway as unknown as MessagesGateway);
  return { service, room, rooms, repository, gateway, events, rows: () => rows, failCommit: (value: boolean) => { failCommit = value; } };
}

describe('Durable direct-text confirmation with retained message UUIDs', () => {
  afterEach(() => jest.restoreAllMocks());
  it('commits before broadcasting, returns a stored sender view, and does not echo account names', async () => {
    const f = fixture(); f.gateway.broadcastMessage.mockImplementation(async () => { expect(f.events).toContain('commit'); });
    const value = await f.service.createDirectTextMessage('room-a', 'a', '  Hello  ', id);
    expect(value).toMatchObject({ id, roomId: 'room-a', text: 'Hello', category: 'direct', direction: 'outgoing', sender: { firstName: 'Community member' } });
    expect(f.rows().size).toBe(1); expect(f.rooms.findOne).toHaveBeenCalledWith(expect.objectContaining({ loadEagerRelations: false, lock: { mode: 'pessimistic_write' } }));
    expect(f.rooms.update).toHaveBeenCalledTimes(1);
  });
  it('concurrent/repeated exact retries return one retained row and never overwrite or rebroadcast it', async () => {
    const f = fixture(); const values = await Promise.all([f.service.createDirectTextMessage('room-a', 'a', 'Hello', id), f.service.createDirectTextMessage('room-a', 'a', 'Hello', id)]);
    expect(values[0]).toEqual(values[1]); expect(f.rows().size).toBe(1);
    expect(f.rooms.update).toHaveBeenCalledTimes(1); expect(f.gateway.broadcastMessage).toHaveBeenCalledTimes(1);
  });
  it.each(['text', 'sender', 'room', 'category', 'image'])('rejects a reused UUID with different %s without overwriting the row', async difference => {
    const f = fixture(); await f.service.createDirectTextMessage('room-a', 'a', 'Hello', id);
    const row = f.rows().get(id)!;
    if (difference === 'sender') row.sender = { id: 'b' } as User;
    if (difference === 'room') row.room = { ...f.room, id: 'another-room' };
    if (difference === 'category') row.category = MessageCategory.GENERAL;
    if (difference === 'image') row.imageUrl = 'https://example.invalid/private.png';
    const snapshot = structuredClone(row);
    await expect(f.service.createDirectTextMessage('room-a', 'a', difference === 'text' ? 'Different' : 'Hello', id)).rejects.toBeInstanceOf(ConflictException);
    expect(f.rows().get(id)).toEqual(snapshot);
  });
  it('commit failure rolls back the message and retry with the same UUID persists it once', async () => {
    const f = fixture(); f.failCommit(true);
    await expect(f.service.createDirectTextMessage('room-a', 'a', 'Hello', id)).rejects.toThrow();
    expect(f.rows().size).toBe(0); expect(f.gateway.broadcastMessage).not.toHaveBeenCalled();
    f.failCommit(false); await f.service.createDirectTextMessage('room-a', 'a', 'Hello', id); expect(f.rows().size).toBe(1);
  });
  it('post-commit realtime failure or a hung broadcaster does not turn saved text into a failed send', async () => {
    const log = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const f = fixture(); f.gateway.broadcastMessage.mockRejectedValue(new Error('PRIVATE_TEXT TOKEN'));
    expect((await f.service.createDirectTextMessage('room-a', 'a', 'Hello', id)).id).toBe(id);
    await Promise.resolve(); expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_TEXT|TOKEN/);
    f.gateway.broadcastMessage.mockImplementation(() => new Promise(() => undefined));
    expect((await f.service.createDirectTextMessage('room-a', 'a', 'Second', '00000000-0000-4000-8000-000000000002')).text).toBe('Second');
  });
  it('denies outsiders/deleted rooms before any message lookup or insert', async () => {
    const f = fixture(); await expect(f.service.createDirectTextMessage('room-a', 'outsider', 'Hello', id)).rejects.toBeInstanceOf(ForbiddenException);
    f.room.deleted = true; await expect(f.service.createDirectTextMessage('room-a', 'a', 'Hello', id)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.repository.createQueryBuilder).not.toHaveBeenCalled(); expect(f.repository.findOneOrFail).not.toHaveBeenCalled();
  });
  it.each(['', ' ', 'x'.repeat(4001)])('rejects empty/oversized text before opening a transaction', async body => {
    const f = fixture(); await expect(f.service.createDirectTextMessage('room-a', 'a', body, id)).rejects.toThrow(); expect(f.events).toEqual([]);
  });
  it('validates the HTTP confirmation contract', async () => {
    expect(await validate(plainToInstance(DirectMessageDto, { clientMessageId: id, text: ' Hello ' }))).toEqual([]);
    for (const body of [{ text: 'Hello' }, { clientMessageId: id, text: ' ' }, { clientMessageId: '../bad', text: 'Hello' }]) expect((await validate(plainToInstance(DirectMessageDto, body))).length).toBeGreaterThan(0);
  });
  it('installed ORM generates a non-overwriting insert and an id-only locked room query offline', async () => {
    const source = new DataSource({ type: 'postgres', entities: [Message, MessageRoom, User, UserRole, Role, KycProfile], synchronize: false, migrationsRun: false, installExtensions: false });
    await (source as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    const insert = source.getRepository(Message).createQueryBuilder().insert().values({ id, room: { id }, sender: { id }, text: 'Hello', category: MessageCategory.DIRECT }).orIgnore().returning(['id']);
    expect(insert.getSql()).toMatch(/ON CONFLICT DO NOTHING/); expect(insert.getSql()).not.toMatch(/DO UPDATE/);
    const locked = source.getRepository(MessageRoom).createQueryBuilder('room').setFindOptions({ where: { id }, loadEagerRelations: false, loadRelationIds: { relations: ['userOne', 'userTwo'], disableMixedMap: true }, lock: { mode: 'pessimistic_write' } });
    expect(locked.getSql()).toContain('FOR UPDATE'); expect(locked.getSql()).not.toMatch(/JOIN|first_name|last_name|email/);
    expect(source.isInitialized).toBe(false);
  });
});
