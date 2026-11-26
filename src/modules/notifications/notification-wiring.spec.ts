import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Socket } from 'socket.io';

import { sessionAccessStub, syntheticSessionId } from '../../testing/session-access-stub.test-support';
import { AuthSessionsService } from '../auth/auth-sessions.service';
import { User, UserStatus } from '../users/user.entity';

import { Notification } from './notification.entity';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

describe('Actual Nest notification service/gateway wiring', () => {
  it.each([false, true])('retains connected socket authorization through circular providers (reverse=%s)', async reverse => {
    const user = { id: 'synthetic-user', status: UserStatus.ACTIVE };
    const jwt = new JwtService({ secret: 'synthetic-notification-wiring' });
    const users = { findOne: jest.fn().mockResolvedValue(user), find: jest.fn().mockResolvedValue([user]) };
    const notifications = { create: jest.fn(value => value), save: jest.fn(async value => ({ ...value, id: 'synthetic-notice', createdAt: new Date() })) };
    const providers = reverse ? [NotificationsGateway, NotificationsService] : [NotificationsService, NotificationsGateway];
    const moduleRef = await Test.createTestingModule({ providers: [...providers,
      { provide: JwtService, useValue: jwt }, { provide: AuthSessionsService, useValue: sessionAccessStub() },
      { provide: getRepositoryToken(User), useValue: users },
      { provide: getRepositoryToken(Notification), useValue: notifications },
    ] }).compile();
    const gateway = moduleRef.get(NotificationsGateway);
    const service = moduleRef.get(NotificationsService);
    const emit = jest.fn(); const to = jest.fn().mockReturnValue({ emit });
    Object.defineProperty(gateway, 'server', { value: { to } });
    const token = await jwt.signAsync({ sub: user.id, sid: syntheticSessionId }, { expiresIn: '1h' });
    const client = { id: 'synthetic-connected-socket', connected: true, data: {}, rooms: new Set(),
      handshake: { auth: { token }, headers: {}, query: {} }, use: jest.fn(), disconnect: jest.fn(), emit: jest.fn() };
    try {
      await gateway.handleConnection(client as unknown as Socket);
      expect(client.emit).toHaveBeenCalledWith('auth:ready');
      const view = await service.createAndEmit(user.id, 'general', 'Synthetic notice');
      expect((service as unknown as { gateway: NotificationsGateway }).gateway).toBe(gateway);
      expect(to).toHaveBeenCalledWith([client.id]);
      expect(emit).toHaveBeenCalledWith('notification:new', view);
      expect(client.disconnect).not.toHaveBeenCalled();
    } finally { gateway.onModuleDestroy(); await moduleRef.close(); }
  });
});
