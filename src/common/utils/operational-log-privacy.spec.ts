import { sessionAccessStub, syntheticSessionId } from '../../testing/session-access-stub.test-support';
import { v2 as cloudinary } from 'cloudinary';
import QRCode from 'qrcode';

import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { Repository } from 'typeorm';

import { Co2EstimationService } from '../../modules/items/co2-estimation.service';
import { MessagesMediaService } from '../../modules/messages/messages-media.service';
import { MessagesPresenceService } from '../../modules/messages/messages-presence.service';
import { MessagesGateway } from '../../modules/messages/messages.gateway';
import { MessagesService } from '../../modules/messages/messages.service';
import { Notification } from '../../modules/notifications/notification.entity';
import { NotificationsGateway } from '../../modules/notifications/notifications.gateway';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { QrImageService } from '../../modules/qr/qr-image.service';
import { User, UserStatus } from '../../modules/users/user.entity';
function activeUsers(): Repository<User> { return { findOne: async () => ({ id: 'synthetic-user', status: UserStatus.ACTIVE }) } as unknown as Repository<User>; }
const secret = 'TOKEN PRIVATE_ADDRESS recipient@example.invalid MESSAGE https://private.invalid';
describe('Operational failure log containment (isolated mocks)', () => {
  let originalEnvironment: NodeJS.ProcessEnv;
  let logs: jest.SpyInstance[];
  beforeEach(() => {
    originalEnvironment = { ...process.env };
    logs = ['error', 'debug', 'log', 'warn', 'verbose'].map((level) => jest.spyOn(Logger.prototype, level as 'error').mockImplementation(() => undefined));
    jest.spyOn(cloudinary, 'config').mockReturnValue({});
  });
  afterEach(() => { process.env = originalEnvironment; jest.restoreAllMocks(); });
  function expectCleanLogs() { expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toMatch(/TOKEN|PRIVATE_ADDRESS|recipient@|MESSAGE|private.invalid/); }
  it.each(['messages', 'notifications'] as const)('contains %s handshake error and disconnects', async (kind) => {
    const jwt = { verifyAsync: jest.fn().mockRejectedValue(new Error(secret)) } as unknown as JwtService;
    const gateway = kind === 'messages' ? new MessagesGateway(jwt, {} as MessagesPresenceService, {} as MessagesService, activeUsers(), sessionAccessStub()) : new NotificationsGateway(jwt, {} as NotificationsService, activeUsers(), sessionAccessStub());
    const disconnect = jest.fn();
    await gateway.handleConnection({ id: secret, handshake: { auth: { token: secret }, headers: {} }, disconnect } as unknown as Socket);
    expect(disconnect).toHaveBeenCalledWith(true); expectCleanLogs();
  });
  it.each(['messages', 'notifications'] as const)('%s socket rejects signed non-access tokens before associating a user', async (kind) => {
    const jwt = new JwtService({ secret: 'synthetic-socket-purpose-key' });
    const presence = { markOnline: jest.fn().mockReturnValue(false) };
    const gateway = kind === 'messages'
      ? new MessagesGateway(jwt, presence as unknown as MessagesPresenceService, {} as MessagesService, activeUsers(), sessionAccessStub())
      : new NotificationsGateway(jwt, {} as NotificationsService, activeUsers(), sessionAccessStub());
    for (const type of ['refresh', 'verify', 'reset']) {
      const token = await jwt.signAsync({ sid: syntheticSessionId, sub: 'synthetic-user', type }, { expiresIn: '1h' });
      const client = { id: 'synthetic-socket', data: {} as { userId?: string }, handshake: { auth: { token }, headers: {} }, disconnect: jest.fn(), use: jest.fn(), emit: jest.fn() };
      await gateway.handleConnection(client as unknown as Socket);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.userId).toBeUndefined();
    }
    expect(presence.markOnline).not.toHaveBeenCalled();
    expectCleanLogs();
  });
  it.each(['messages', 'notifications'] as const)('%s socket preserves valid legacy access authentication', async (kind) => {
    const jwt = new JwtService({ secret: 'synthetic-socket-purpose-key' });
    const presence = { markOnline: jest.fn().mockReturnValue(false) };
    const gateway = kind === 'messages'
      ? new MessagesGateway(jwt, presence as unknown as MessagesPresenceService, {} as MessagesService, activeUsers(), sessionAccessStub())
      : new NotificationsGateway(jwt, {} as NotificationsService, activeUsers(), sessionAccessStub());
    const token = await jwt.signAsync({ sid: syntheticSessionId, sub: 'synthetic-user' }, { expiresIn: '1h' });
    const client = { id: 'synthetic-socket', data: {} as { userId?: string }, handshake: { auth: { token }, headers: {} }, disconnect: jest.fn(), use: jest.fn(), emit: jest.fn() };
    await gateway.handleConnection(client as unknown as Socket);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.data.userId).toBe('synthetic-user');
    gateway.onModuleDestroy();
  });
  it('logs notification count without private user/title and contains emit failure', async () => {
    const query = { leftJoinAndSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), take: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([{ id: secret, user: { id: secret }, title: secret, type: 'general' }]) };
    const rows = { createQueryBuilder: () => query, create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
    const users = { findOne: jest.fn().mockResolvedValue({ id: secret }) };
    const gateway = { emitToUser: jest.fn().mockRejectedValue(new Error(secret)) };
    const service = new NotificationsService(rows as unknown as Repository<Notification>, users as unknown as Repository<User>, gateway as unknown as NotificationsGateway);
    await service.listForUser(secret); await service.createAndEmit(secret, 'general', secret, secret);
    expect(gateway.emitToUser).toHaveBeenCalled(); expectCleanLogs();
  });
  it('contains asynchronous message upload failure and returns generic provider error', async () => {
    jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(((_options: unknown, callback: unknown) => ({ end: () => (callback as (error: unknown) => void)(new Error(secret)) })) as never);
    await expect(new MessagesMediaService().uploadImage(Buffer.from('synthetic'), secret)).rejects.toThrow('Failed to upload message image');
    expectCleanLogs();
  });
  it('contains QR generation failure without content or stack', async () => {
    jest.spyOn(QRCode, 'toBuffer').mockRejectedValue(new Error(secret));
    await expect(new QrImageService().generateAndUploadItemQrPng(secret)).rejects.toThrow('Failed to generate QR PNG'); expectCleanLogs();
  });
  it.each(['response', 'network'] as const)('contains CO2 %s provider failure', async (kind) => {
    process.env.CLIMATIQ_API_KEY = 'synthetic-key'; process.env.CLIMATIQ_EMISSION_FACTOR_ID = 'synthetic-factor';
    process.env.CLIMATIQ_API_URL = 'https://api.example.test/estimate';
    process.env.CO2_AVOIDED_METHOD_REFERENCE = 'synthetic-reviewed-method';
    const text = jest.fn().mockResolvedValue(secret);
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    if (kind === 'response') fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: secret, text } as unknown as Response);
    else fetchMock.mockRejectedValue(new Error(secret));
    await expect(new Co2EstimationService().estimateSavedCo2Kg({ weightKg: 1 })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(text).not.toHaveBeenCalled(); expectCleanLogs();
  });
});
