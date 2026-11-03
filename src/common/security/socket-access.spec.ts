import { sessionAccessStub, syntheticSessionId } from '../../testing/session-access-stub.test-support';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { Repository } from 'typeorm';

import { MessagesPresenceService } from '../../modules/messages/messages-presence.service';
import { MessagesGateway } from '../../modules/messages/messages.gateway';
import { MessagesService } from '../../modules/messages/messages.service';
import { NotificationViewModel } from '../../modules/notifications/notification.entity';
import { NotificationsGateway } from '../../modules/notifications/notifications.gateway';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { User, UserStatus } from '../../modules/users/user.entity';

import { SocketAccess } from './socket-access';

function socket(id = 'synthetic-socket') {
  const client = {
    id, connected: true, rooms: new Set(['synthetic-room']),
    data: {} as { userId?: string }, handshake: { auth: { token: '' }, headers: {}, query: {} },
    use: jest.fn(), disconnect: jest.fn(), emit: jest.fn(), join: jest.fn(),
  };
  client.disconnect.mockImplementation(() => { client.connected = false; });
  return { client, asSocket: client as unknown as Socket };
}

describe('Socket authorization lifetime (no listeners or real accounts)', () => {
  const jwt = new JwtService({ secret: 'synthetic-socket-lifetime-key' });
  let users: { findOne: jest.Mock; find: jest.Mock };
  let access: SocketAccess;
  beforeEach(() => {
    jest.useFakeTimers();
    users = { findOne: jest.fn().mockResolvedValue({ id: 'synthetic-user', status: UserStatus.ACTIVE }), find: jest.fn() };
    users.find.mockImplementation(async () => { const user = await users.findOne(); return user ? [user] : []; });
    access = new SocketAccess(jwt, users as unknown as Repository<User>, sessionAccessStub());
  });
  afterEach(() => { access.destroy(); jest.useRealTimers(); });
  const token = (seconds = 5) => jwt.sign({ sid: syntheticSessionId, sub: 'synthetic-user' }, { expiresIn: seconds });

  it('disconnects exactly at expiry without waiting for another client event', async () => {
    jest.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    const client = socket();
    await access.connect(client.asSocket, await token());
    await jest.advanceTimersByTimeAsync(4999);
    expect(client.client.disconnect).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(client.client.disconnect).toHaveBeenCalledWith(true);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('clamps long expiry timers and never treats the intermediate wake as expiry', async () => {
    jest.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    const client = socket();
    await access.connect(client.asSocket, await token(60 * 86400));
    await jest.advanceTimersByTimeAsync(2_147_483_647);
    expect(client.client.disconnect).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
  });
  it('released old timers cannot disconnect a later connection', async () => {
    const old = socket();
    await access.connect(old.asSocket, await token());
    access.release(old.asSocket);
    const current = socket();
    await access.connect(current.asSocket, await token(60));
    await jest.advanceTimersByTimeAsync(5000);
    expect(current.client.disconnect).not.toHaveBeenCalled();
    expect(old.client.disconnect).not.toHaveBeenCalled();
  });
  it('destroys owned timers and connections on shutdown', async () => {
    const client = socket();
    await access.connect(client.asSocket, await token());
    access.destroy();
    expect(jest.getTimerCount()).toBe(0);
    expect(client.client.disconnect).toHaveBeenCalledTimes(1);
  });
  it.each([UserStatus.SUSPENDED, UserStatus.DELETED, UserStatus.PENDING])('blocks incoming packets after current status changes to %s', async status => {
    const client = socket();
    await access.connect(client.asSocket, await token());
    users.findOne.mockResolvedValue({ id: 'synthetic-user', status });
    const middleware = client.client.use.mock.calls[0][0] as (packet: unknown[], next: (error?: Error) => void) => void;
    const next = jest.fn();
    middleware(['message:send', { text: 'private synthetic message' }], next);
    await jest.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(client.client.disconnect).toHaveBeenCalledWith(true);
  });
  it('excludes a suspended recipient before private outbound delivery', async () => {
    const client = socket();
    await access.connect(client.asSocket, await token());
    expect(await access.authorizedIds('synthetic-user', 'synthetic-room')).toEqual(['synthetic-socket']);
    users.findOne.mockResolvedValue({ id: 'synthetic-user', status: UserStatus.SUSPENDED });
    expect(await access.authorizedIds('synthetic-user')).toEqual([]);
    expect(client.client.disconnect).toHaveBeenCalledWith(true);
  });
  it('checks current account state once per outbound batch, even with multiple same-user sockets', async () => {
    const one = socket('one'), two = socket('two');
    await access.connect(one.asSocket, token()); await access.connect(two.asSocket, token());
    expect(await access.authorizedIds('synthetic-user')).toEqual(['one', 'two']);
    expect(users.find).toHaveBeenCalledTimes(1);
    expect(users.find.mock.calls[0][0].where.id.value).toEqual(['synthetic-user']);
  });
  it('fails closed on an account-store outage during outbound delivery', async () => {
    const client = socket();
    await access.connect(client.asSocket, await token());
    users.findOne.mockRejectedValue(new Error('synthetic store outage'));
    expect(await access.authorizedIds()).toEqual([]);
    expect(client.client.disconnect).toHaveBeenCalledWith(true);
  });
  it('a late account lookup cannot reauthorize a released socket', async () => {
    const client = socket();
    await access.connect(client.asSocket, await token());
    let resolve!: (value: User) => void;
    users.findOne.mockReturnValue(new Promise<User>(done => { resolve = done; }));
    const pending = access.authorize(client.asSocket);
    await jest.advanceTimersByTimeAsync(0);
    access.release(client.asSocket);
    resolve({ id: 'synthetic-user', status: UserStatus.ACTIVE } as User);
    await expect(pending).rejects.toThrow('Socket disconnected');
    expect(await access.authorizedIds()).toEqual([]);
  });
  it('does not register a socket disconnected during the initial lookup', async () => {
    const client = socket();
    client.client.connected = false;
    await expect(access.connect(client.asSocket, await token())).rejects.toThrow('Socket disconnected');
    expect(client.client.use).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
  it('notification gateway withholds private output and read actions after suspension', async () => {
    const client = socket(); client.client.handshake.auth.token = token();
    const markRead = jest.fn(); const emit = jest.fn(); const to = jest.fn().mockReturnValue({ emit });
    const gateway = new NotificationsGateway(jwt, { markRead } as unknown as NotificationsService, users as unknown as Repository<User>, sessionAccessStub());
    Object.defineProperty(gateway, 'server', { value: { to } });
    try {
      await gateway.handleConnection(client.asSocket);
      expect(client.client.emit).toHaveBeenCalledWith('auth:ready');
      users.findOne.mockResolvedValue({ id: 'synthetic-user', status: UserStatus.SUSPENDED });
      await gateway.emitToUser('synthetic-user', { title: 'PRIVATE_MESSAGE' } as NotificationViewModel);
      expect(to).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled();
      await expect(gateway.handleMarkRead(client.asSocket, { id: 'synthetic-notification' })).rejects.toThrow('authentication required');
      expect(markRead).not.toHaveBeenCalled();
    } finally { gateway.onModuleDestroy(); }
  });
  it('message gateway rejects a direct send after account deletion before any message write', async () => {
    const client = socket(); client.client.handshake.auth.token = token();
    const createDirectTextMessage = jest.fn();
    const gateway = new MessagesGateway(jwt, { markOnline: jest.fn().mockReturnValue(false) } as unknown as MessagesPresenceService,
      { createDirectTextMessage } as unknown as MessagesService, users as unknown as Repository<User>, sessionAccessStub());
    try {
      await gateway.handleConnection(client.asSocket);
      users.findOne.mockResolvedValue({ id: 'synthetic-user', status: UserStatus.DELETED });
      await expect(gateway.handleSendMessage(client.asSocket, { roomId: 'synthetic-room', text: 'PRIVATE_MESSAGE' })).rejects.toThrow('Invalid access token');
      expect(createDirectTextMessage).not.toHaveBeenCalled();
    } finally { gateway.onModuleDestroy(); }
  });
  it('cannot join another private room by sending an empty message payload', async () => {
    const client = socket(); client.client.handshake.auth.token = token();
    const getRoomOrFail = jest.fn().mockRejectedValue(new Error('You do not have access to this room'));
    const createDirectTextMessage = jest.fn();
    const gateway = new MessagesGateway(jwt, { markOnline: jest.fn().mockReturnValue(false) } as unknown as MessagesPresenceService,
      { getRoomOrFail, createDirectTextMessage } as unknown as MessagesService, users as unknown as Repository<User>, sessionAccessStub());
    try {
      await gateway.handleConnection(client.asSocket);
      await expect(gateway.handleSendMessage(client.asSocket, { roomId: 'someone-elses-room' })).rejects.toThrow('do not have access');
      expect(client.client.join).not.toHaveBeenCalled();
      expect(createDirectTextMessage).not.toHaveBeenCalled();
    } finally { gateway.onModuleDestroy(); }
  });
});
