import { BadRequestException, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { firstValueFrom, of } from 'rxjs';

import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { ReadNotificationsDto } from './dto/read-notifications.dto';
import { Notification } from './notification.entity';

import { SendNotificationDto } from './dto/send-notification.dto';
import { EmailService } from './email.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const actorId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
function fixture() {
  const notifications = { createAndEmit: jest.fn().mockResolvedValue({ id: 'synthetic-notification' }) };
  const controller = new NotificationsController(notifications as unknown as NotificationsService, {} as EmailService);
  return { notifications, controller };
}

describe('Notification recipient authorization', () => {
  it.each([{ ids: ['invalid'] }, { ids: [actorId, ''] }, { ids: Array.from({ length: 101 }, () => actorId) }])(
    'rejects invalid read IDs at the shared service boundary %j', async ({ ids }) => {
      const update = jest.fn();
      const service = new NotificationsService({ update } as unknown as Repository<Notification>, {} as Repository<User>);
      await expect(service.markRead(actorId, ids)).rejects.toBeInstanceOf(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    },
  );
  it('scopes selected and all read updates to the authenticated account', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 2 });
    const service = new NotificationsService({ update } as unknown as Repository<Notification>, {} as Repository<User>);
    const controller = new NotificationsController(service, {} as EmailService);
    const ids = ['00000000-0000-4000-8000-000000000003'];
    await expect(controller.read({ user: { sub: actorId } }, { ids })).resolves.toEqual({ updated: 2 });
    expect(update.mock.calls[0][0]).toMatchObject({ user: { id: actorId }, read: false });
    expect(update.mock.calls[0][0].id.value).toEqual(ids);
    await expect(controller.readAll({ user: { sub: actorId } })).resolves.toEqual({ updated: 2 });
    expect(update.mock.calls[1][0]).toEqual({ user: { id: actorId }, read: false });
    expect(update.mock.calls[1][1]).toEqual({ read: true, readAt: expect.any(Date) });
    await expect(controller.readAll({ user: { roles: ['admin'] } })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it.each([{ ids: [] }, { ids: [actorId, actorId] }, { ids: ['invalid'] }, { ids: Array.from({ length: 101 }, () => actorId) }])(
    'rejects invalid selected notification IDs %j', async ({ ids }) => {
      expect((await validate(plainToInstance(ReadNotificationsDto, { ids }))).length).toBeGreaterThan(0);
    },
  );
  it('allows self delivery using the authenticated recipient ID', async () => {
    const f = fixture();
    expect(await f.controller.send({ user: { sub: actorId } }, { userId: actorId, template: 'Synthetic notice', params: { source: 'qa' } }))
      .toEqual({ status: 'success', message: 'OK', data: { id: 'synthetic-notification' } });
    expect(f.notifications.createAndEmit).toHaveBeenCalledWith(actorId, 'general', 'Synthetic notice', null, { source: 'qa' });
  });
  it('preserves notice identity and business data through the actual response interceptor', async () => {
    const f = fixture();
    const view = { id: 'synthetic-notification', userId: actorId, type: 'general', title: 'Synthetic notice',
      data: { source: 'qa', itemId: 'synthetic-item' }, read: false };
    f.notifications.createAndEmit.mockResolvedValue(view);
    const result = await f.controller.send({ user: { sub: actorId } }, { userId: actorId, template: 'Synthetic notice', params: view.data });
    const context = { switchToHttp: () => ({ getResponse: () => ({ statusCode: 201 }) }),
      getHandler: () => f.controller.send, getClass: () => NotificationsController } as unknown as ExecutionContext;
    const response = await firstValueFrom(new ResponseInterceptor(new Reflector()).intercept(context, { handle: () => of(result) }));
    expect(response).toEqual({ status: 'success', message: 'OK', data: view });
    expect(response.data.id).toBe(view.id); expect(response.data.data).toEqual(view.data);
  });
  it.each([{}, { roles: ['admin'] }, { userRoles: [{ role: { code: 'admin' } }] }])('rejects another recipient without an inferred role bypass %j', async claims => {
    const f = fixture();
    await expect(f.controller.send({ user: { sub: actorId, ...claims } }, { userId: otherId, template: 'Synthetic notice' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(f.notifications.createAndEmit).not.toHaveBeenCalled();
  });
  it.each([{}, { user: {} }, { user: { sub: ' ' } }])('rejects missing principal before delivery %j', async req => {
    const f = fixture();
    await expect(f.controller.send(req, { userId: actorId, template: 'Synthetic notice' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.notifications.createAndEmit).not.toHaveBeenCalled();
  });
  it('trims a valid title without accepting a forged target or invalid payload', async () => {
    const dto = plainToInstance(SendNotificationDto, { userId: actorId, template: ' Synthetic notice ', params: { source: 'qa' } });
    expect(await validate(dto)).toEqual([]); expect(dto.template).toBe('Synthetic notice');
  });
  it.each([{ userId: '' }, { userId: '../other' }, { template: '' }, { template: ' ' }, { template: 'x'.repeat(121) },
    { template: 42 }, { params: [] }, { params: 'text' }])('rejects invalid DTO %j', async override => {
    const dto = plainToInstance(SendNotificationDto, { userId: actorId, template: 'Synthetic notice', ...override });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
