import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { User } from '../users/user.entity';

import { MessageRoom } from './message-room.entity';
import { Message, MessageCategory } from './message.entity';
import { MessagesMediaService } from './messages-media.service';
import { MessagesPresenceService } from './messages-presence.service';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';

function queryMock() {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(), take: jest.fn().mockReturnThis(),
    getOne: jest.fn(), getMany: jest.fn(),
  };
}

describe.each(['named', 'email-only'])('Chat identity privacy: %s accounts', (profile) => {
  let service: MessagesService;
  let room: MessageRoom;
  let message: Message;
  let people: User[];
  let query: ReturnType<typeof queryMock>;
  const rooms = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn() };
  const messages = { query: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn(), create: jest.fn(), save: jest.fn(), findOneOrFail: jest.fn(), findOne: jest.fn() };
  const users = { findBy: jest.fn() };
  const gateway = { broadcastMessage: jest.fn() };
  const media = { uploadImage: jest.fn() };

  function assertNoAccountNames(value: unknown) {
    expect(JSON.stringify(value)).not.toMatch(/PRIVATE_FIRST|PRIVATE_LAST|private-email/);
  }

  function assertLabel(sender: { id: string; firstName: string | null; lastName: string | null } | null) {
    expect(sender).toMatchObject({ firstName: 'Community member', lastName: null });
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    people = ['member-a', 'member-b'].map((id) => Object.assign(new User(), {
      id, firstName: profile === 'named' ? `PRIVATE_FIRST-${id}` : null,
      lastName: profile === 'named' ? `PRIVATE_LAST-${id}` : null,
      email: `private-email-${id}@example.test`, profileImageUrl: 'https://example.test/avatar.png',
    }));
    room = Object.assign(new MessageRoom(), { id: 'room-id', userOne: people[0], userTwo: people[1],
      pairKey: MessageRoom.buildPairKey(people[0].id, people[1].id), deleted: false,
      createdAt: new Date('2026-11-03T00:00:00Z'), updatedAt: new Date('2026-11-03T00:01:00Z') });
    message = Object.assign(new Message(), { id: 'message-id', room, sender: people[0],
      category: MessageCategory.DIRECT, text: 'Synthetic private conversation', caption: null,
      imageUrl: null, createdAt: new Date('2026-11-03T00:01:00Z') });
    rooms.findOne.mockResolvedValue(room); rooms.find.mockResolvedValue([room]);
    messages.query.mockResolvedValue([]);
    rooms.create.mockImplementation((value: Partial<MessageRoom>) => value);
    rooms.save.mockResolvedValue(room); rooms.update.mockResolvedValue({ affected: 1 });
    users.findBy.mockResolvedValue(people);
    query = queryMock(); query.getOne.mockResolvedValue(message); query.getMany.mockResolvedValue([message]);
    Object.assign(query, { insert: jest.fn().mockReturnThis(), orIgnore: jest.fn().mockReturnThis(), returning: jest.fn().mockReturnThis(),
      values: jest.fn().mockImplementation((value: Partial<Message>) => { message.id = value.id!; message.text = value.text; return query; }),
      execute: jest.fn().mockImplementation(async () => ({ raw: [{ id: message.id }] })) });
    const manager = { getRepository: (entity: unknown) => entity === MessageRoom ? rooms : messages };
    Object.assign(messages, { manager: { transaction: async (work: (tx: unknown) => Promise<unknown>) => work(manager) } });
    messages.createQueryBuilder.mockReturnValue(query);
    messages.create.mockImplementation((value: Partial<Message>) => value);
    messages.save.mockResolvedValue(message); messages.findOneOrFail.mockResolvedValue(message);
    media.uploadImage.mockResolvedValue('https://example.test/synthetic-image.png');
    const moduleRef = await Test.createTestingModule({ providers: [MessagesService,
      { provide: getRepositoryToken(MessageRoom), useValue: rooms },
      { provide: getRepositoryToken(Message), useValue: messages },
      { provide: getRepositoryToken(User), useValue: users },
      { provide: MessagesMediaService, useValue: media },
      { provide: MessagesPresenceService, useValue: { isOnline: (id: string) => id === 'member-a' } },
      { provide: MessagesGateway, useValue: gateway },
    ] }).compile();
    service = moduleRef.get(MessagesService);
  });

  it.each(['member-a', 'member-b'])('neutralises rooms and previews for %s', async (viewer) => {
    const result = await service.listActiveRooms(viewer);
    expect(result[0].participants.map(({ id }) => id)).toEqual(['member-a', 'member-b']);
    result[0].participants.forEach(assertLabel);
    assertLabel(result[0].lastMessage!.sender);
    expect(result[0].participants.map(({ online }) => online)).toEqual([true, false]);
    expect(result[0].lastMessage!.direction).toBe(viewer === 'member-a' ? 'outgoing' : 'incoming');
    expect(rooms.find).toHaveBeenCalledWith({ where: [
      { userOne: { id: viewer }, deleted: false }, { userTwo: { id: viewer }, deleted: false },
    ], order: { updatedAt: 'DESC' } });
    assertNoAccountNames(result);
  });

  it('neutralises an ensured-room response without mutating account records', async () => {
    const result = await service.ensureRoom('member-a', 'member-b');
    result.participants.forEach(assertLabel);
    assertNoAccountNames(result);
    expect(people[0].email).toContain('private-email');
    expect(people[0].firstName).toBe(profile === 'named' ? 'PRIVATE_FIRST-member-a' : null);
    expect(rooms.save).not.toHaveBeenCalled();
  });

  it.each(['member-a', 'member-b'])('neutralises history and search sender projections for %s', async (viewer) => {
    const history = await service.listMessages(room.id, viewer, { limit: 10 });
    const search = await service.searchMessages(room.id, viewer, 'Synthetic');
    assertLabel(history.messages[0].sender); assertLabel(search[0].sender);
    expect(history.messages[0].text).toBe(message.text);
    expect(history.messages[0].sender!.id).toBe('member-a');
    expect(history.messages[0].sender!.profileImageUrl).toBe(people[0].profileImageUrl);
    expect(history.nextCursor).toBeNull();
    assertNoAccountNames(history); assertNoAccountNames(search);
  });

  it.each(['text', 'general', 'image'])('neutralises %s replies and both per-viewer realtime payloads', async (kind) => {
    if (kind === 'general') message.category = MessageCategory.GENERAL;
    const result = kind === 'text'
      ? await service.createDirectTextMessage(room.id, 'member-a', message.text!)
      : kind === 'general'
        ? await service.createGeneralMessage(room.id, 'member-a', { text: message.text! })
        : await service.sendImageMessage(room.id, 'member-a', {
          buffer: Buffer.from('synthetic'), mimetype: 'image/png', originalname: 'synthetic.png',
        } as Express.Multer.File, {});
    assertLabel(result.sender); assertNoAccountNames(result);
    const [broadcastRoom, payloads] = gateway.broadcastMessage.mock.calls[0] as [string, Array<{
      userId: string; message: typeof result;
    }>];
    expect(broadcastRoom).toBe(room.id);
    expect(payloads.map(({ userId }) => userId)).toEqual(['member-a', 'member-b']);
    expect(payloads.map(({ message: view }) => view.direction)).toEqual(
      kind === 'general' ? ['general', 'general'] : ['outgoing', 'incoming'],
    );
    payloads.forEach(({ message: view }) => assertLabel(view.sender));
    assertNoAccountNames(payloads);
    expect(rooms.update).toHaveBeenCalledWith({ id: room.id }, { updatedAt: expect.any(Date) });
  });

  it('keeps null system senders null', async () => {
    message.sender = null;
    message.category = MessageCategory.GENERAL;
    const result = await service.listMessages(room.id, 'member-b', {});
    expect(result.messages[0].sender).toBeNull();
    expect(result.messages[0].direction).toBe('general');
  });
  it('uses timestamp plus UUID for history cursors so equal-time messages are not skipped', async () => {
    messages.findOne.mockResolvedValue(message);
    await service.listMessages(room.id, 'member-a', { limit: 10, cursor: message.id });
    expect(query.andWhere).toHaveBeenCalledWith('(message.createdAt < :cursor OR (message.createdAt = :cursor AND message.id < :cursorId))', { cursor: message.createdAt, cursorId: message.id });
  });

  it('denies outsiders before history, search or send activity', async () => {
    await expect(service.listMessages(room.id, 'outsider', {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.searchMessages(room.id, 'outsider', 'Synthetic')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createDirectTextMessage(room.id, 'outsider', 'Synthetic')).rejects.toBeInstanceOf(ForbiddenException);
    expect(messages.createQueryBuilder).not.toHaveBeenCalled();
    expect(messages.save).not.toHaveBeenCalled();
    expect(gateway.broadcastMessage).not.toHaveBeenCalled();
  });

  it('keeps deleted rooms inaccessible', async () => {
    room.deleted = true;
    await expect(service.listMessages(room.id, 'member-a', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(messages.createQueryBuilder).not.toHaveBeenCalled();
  });
});
