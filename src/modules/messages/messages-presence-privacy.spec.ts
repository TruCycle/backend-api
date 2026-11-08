import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';

import { AuthSessionsService } from '../auth/auth-sessions.service';
import { KycProfile } from '../users/kyc-profile.entity';
import { Role } from '../users/role.entity';
import { UserRole } from '../users/user-role.entity';
import { User } from '../users/user.entity';

import { MessageRoom } from './message-room.entity';
import { Message } from './message.entity';
import { MessagesMediaService } from './messages-media.service';
import { MessagesPresenceService } from './messages-presence.service';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';

function audienceFixture() {
  const query = { select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getRawMany: jest.fn() };
  const rooms = { createQueryBuilder: jest.fn().mockReturnValue(query) };
  const service = new MessagesService(rooms as unknown as Repository<MessageRoom>, {} as Repository<Message>,
    {} as Repository<User>, {} as MessagesMediaService, {} as MessagesPresenceService);
  return { service, query };
}

describe('Conversation-scoped presence', () => {
  afterEach(() => jest.restoreAllMocks());

  it('restricts the audience lookup to undeleted rooms with the subject as a participant', async () => {
    const { service, query } = audienceFixture();
    query.getRawMany.mockResolvedValue([
      { userOneId: 'a', userTwoId: 'b' }, { userOneId: 'c', userTwoId: 'a' },
      { userOneId: 'a', userTwoId: 'b' }, { userOneId: 'unrelated', userTwoId: 'outsider' },
    ]);
    expect(await service.presenceRecipientIds('a')).toEqual(['a', 'b', 'c']);
    expect(query.where).toHaveBeenCalledWith('room.deleted = :deleted', { deleted: false });
    expect(query.andWhere).toHaveBeenCalledWith('(room.userOne = :userId OR room.userTwo = :userId)', { userId: 'a' });
  });

  it('only returns the subject when there are no existing conversations', async () => {
    const { service, query } = audienceFixture(); query.getRawMany.mockResolvedValue([]);
    expect(await service.presenceRecipientIds('a')).toEqual(['a']);
  });

  it('installed ORM selects account IDs without joining or reading account profiles', async () => {
    const source = new DataSource({ type: 'postgres', entities: [Message, MessageRoom, User, UserRole, Role, KycProfile],
      synchronize: false, migrationsRun: false, installExtensions: false });
    await (source as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    const repository = source.getRepository(MessageRoom);
    const original = repository.createQueryBuilder.bind(repository);
    let sql = ''; let parameters: unknown[] = [];
    jest.spyOn(repository, 'createQueryBuilder').mockImplementation((alias?: string) => {
      const builder = original(alias);
      jest.spyOn(builder, 'getRawMany').mockImplementation(async () => {
        [sql, parameters] = builder.getQueryAndParameters(); return [];
      });
      return builder;
    });
    const service = new MessagesService(repository, {} as Repository<Message>, {} as Repository<User>,
      {} as MessagesMediaService, {} as MessagesPresenceService);
    await service.presenceRecipientIds('00000000-0000-4000-8000-000000000001');
    expect(sql).toMatch(/"userOneId"/); expect(sql).toMatch(/"userTwoId"/);
    expect(sql).toMatch(/"deleted" = \$1/); expect(sql).toMatch(/ OR /);
    expect(sql).not.toMatch(/JOIN|email|password|firstName|lastName/);
    expect(parameters).toEqual([false, '00000000-0000-4000-8000-000000000001']);
  });

  function gatewayFixture() {
    const messages = { presenceRecipientIds: jest.fn().mockResolvedValue(['a', 'b']) };
    const gateway = new MessagesGateway({} as JwtService, {} as MessagesPresenceService,
      messages as unknown as MessagesService, {} as Repository<User>, {} as AuthSessionsService);
    const emit = jest.fn(); const to = jest.fn().mockReturnValue({ emit });
    Object.defineProperty(gateway, 'server', { value: { to } });
    const access = (gateway as unknown as { access: { authorizedIds(userId?: string): Promise<string[]> } }).access;
    const authorized = jest.spyOn(access, 'authorizedIds').mockImplementation(async userId =>
      userId === 'a' ? ['a-one', 'a-two'] : userId === 'b' ? ['b-one'] : ['outsider']);
    const broadcast = (online: boolean) => (gateway as unknown as {
      broadcastPresence(userId: string, online: boolean): Promise<void>;
    }).broadcastPresence('a', online);
    return { gateway, messages, authorized, to, emit, broadcast };
  }

  it.each([true, false])('sends online=%s only to currently authorized participant sockets', async online => {
    const f = gatewayFixture();
    await f.broadcast(online);
    expect(f.authorized.mock.calls).toEqual([['a'], ['b']]);
    expect(f.to).toHaveBeenCalledWith(['a-one', 'a-two', 'b-one']);
    expect(f.emit).toHaveBeenCalledWith('presence:update', { userId: 'a', online });
    f.gateway.onModuleDestroy();
  });

  it('withholds presence from revoked recipients', async () => {
    const f = gatewayFixture(); f.authorized.mockResolvedValue([]);
    await f.broadcast(true); expect(f.to).not.toHaveBeenCalled(); f.gateway.onModuleDestroy();
  });

  it('fails closed on audience lookup failure without leaking private errors', async () => {
    const log = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const f = gatewayFixture(); f.messages.presenceRecipientIds.mockRejectedValue(new Error('PRIVATE_EMAIL TOKEN'));
    await expect(f.broadcast(true)).resolves.toBeUndefined();
    expect(f.authorized).not.toHaveBeenCalled(); expect(f.to).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_EMAIL|TOKEN/); f.gateway.onModuleDestroy();
  });
});
