import 'reflect-metadata';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';

import { CanActivate, HttpServer, NestInterceptor, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { GuardsConsumer } from '@nestjs/core/guards/guards-consumer';
import { InterceptorsConsumer } from '@nestjs/core/interceptors/interceptors-consumer';
import { PipesConsumer } from '@nestjs/core/pipes/pipes-consumer';
import { RouteParamsFactory } from '@nestjs/core/router/route-params-factory';
import { RouterExecutionContext } from '@nestjs/core/router/router-execution-context';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { Repository } from 'typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SocketAccess } from '../../common/security/socket-access';
import { sessionAccessStub, syntheticSessionId } from '../../testing/session-access-stub.test-support';
import { User, UserStatus } from '../users/user.entity';

import { MAX_MESSAGE_IMAGE_BYTES, MessagesMediaService } from './messages-media.service';
import { MessagesPresenceService } from './messages-presence.service';
import { MessageAttachmentsUnavailableGuard, MessagesController } from './messages.controller';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';

jest.mock('cloudinary', () => ({ v2: { config: jest.fn(), uploader: { upload_stream: jest.fn() } } }));

// Run Nest's actual route execution pipeline without opening a server listener.
function restPipeline(authenticate: CanActivate) {
  const controller = new MessagesController({ sendImageMessage: jest.fn() } as unknown as MessagesService);
  const callback = controller.sendImageMessage;
  const guard = new MessageAttachmentsUnavailableGuard();
  const guardCall = jest.spyOn(guard, 'canActivate');
  const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, MessagesController);
  const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, callback);
  expect(classGuards).toEqual([JwtAuthGuard]);
  expect(methodGuards).toEqual([MessageAttachmentsUnavailableGuard]);
  const interceptorTypes: (new () => NestInterceptor)[] = Reflect.getMetadata(INTERCEPTORS_METADATA, callback);
  const interceptors = interceptorTypes.map(Type => new Type());
  expect(interceptors).toHaveLength(1);
  const parser = jest.spyOn(interceptors[0], 'intercept');
  const pipes = { create: () => [], setModuleContext() {}, createConcreteContext: () => [] };
  const guards = { create: () => [...classGuards, ...methodGuards].map(Type => Type === JwtAuthGuard ? authenticate : guard) };
  const interceptorContext = { create: () => interceptors };
  const execution = new RouterExecutionContext(new RouteParamsFactory(),
    pipes as unknown as ConstructorParameters<typeof RouterExecutionContext>[1], new PipesConsumer(),
    guards as unknown as ConstructorParameters<typeof RouterExecutionContext>[3], new GuardsConsumer(),
    interceptorContext as unknown as ConstructorParameters<typeof RouterExecutionContext>[5], new InterceptorsConsumer(),
    {} as HttpServer);
  return { route: execution.create(controller, callback, 'sendImageMessage', 'synthetic-module', RequestMethod.POST), parser, guardCall };
}

describe('Private attachment safety', () => {
  const previous = process.env.MESSAGE_ATTACHMENTS_ENABLED;
  beforeEach(() => { delete process.env.MESSAGE_ATTACHMENTS_ENABLED; });
  afterEach(() => {
    if (previous === undefined) delete process.env.MESSAGE_ATTACHMENTS_ENABLED;
    else process.env.MESSAGE_ATTACHMENTS_ENABLED = previous;
  });

  it('rejects authenticated REST image requests before the real multipart interceptor executes', async () => {
    const authenticate = { canActivate: jest.fn().mockReturnValue(true) };
    const { route, parser, guardCall } = restPipeline(authenticate);
    await expect(route({ headers: { 'content-type': 'multipart/form-data; boundary=synthetic' } }, {}, jest.fn()))
      .rejects.toMatchObject({ status: 503, message: 'Image attachments are unavailable' });
    expect(authenticate.canActivate).toHaveBeenCalledTimes(1);
    expect(guardCall).toHaveBeenCalledTimes(1);
    expect(parser).not.toHaveBeenCalled();
  });

  it('keeps authentication before the unavailable response and multipart buffering', async () => {
    const authenticate = { canActivate: jest.fn(() => { throw new UnauthorizedException(); }) };
    const { route, parser, guardCall } = restPipeline(authenticate);
    await expect(route({}, {}, jest.fn())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(guardCall).not.toHaveBeenCalled(); expect(parser).not.toHaveBeenCalled();
  });

  it('opens authenticated multipart only when the pilot is explicitly enabled', () => {
    process.env.MESSAGE_ATTACHMENTS_ENABLED = 'true';
    expect(new MessageAttachmentsUnavailableGuard().canActivate()).toBe(true);
  });

  it('re-encodes a valid image without metadata or public storage', async () => {
    const media = new MessagesMediaService();
    const source = await sharp({ create: { width: 10, height: 12, channels: 3, background: '#123456' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const prepared = await media.prepareImage(source);
    expect(prepared.contentType).toBe('image/webp');
    expect(prepared.sourceDigest).toHaveLength(32);
    const output = await sharp(prepared.payload).metadata();
    expect(output).toMatchObject({ format: 'webp', width: 12, height: 10 });
    expect(output.exif).toBeUndefined();
    expect(cloudinary.config).not.toHaveBeenCalled();
    expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
  });

  it('rejects spoofed, malformed, oversized and excessive-dimension input', async () => {
    const media = new MessagesMediaService();
    const tooWide = await sharp({ create: { width: 2049, height: 1, channels: 3, background: '#123456' } })
      .png().toBuffer();
    await expect(media.prepareImage(Buffer.from('<svg/>'))).rejects.toMatchObject({ status: 400 });
    await expect(media.prepareImage(Buffer.from([255, 216, 255]))).rejects.toMatchObject({ status: 400 });
    await expect(media.prepareImage(Buffer.alloc(MAX_MESSAGE_IMAGE_BYTES + 1))).rejects.toMatchObject({ status: 413 });
    await expect(media.prepareImage(tooWide)).rejects.toMatchObject({ status: 400 });
  });

  function socketFixture() {
    const jwt = new JwtService({ secret: 'synthetic-attachment-safety-key' });
    const users = { findOne: jest.fn().mockResolvedValue({ id: 'sender', status: UserStatus.ACTIVE }), find: jest.fn() };
    users.find.mockImplementation(async () => [await users.findOne()]);
    const messages = { getRoomOrFail: jest.fn().mockResolvedValue({ id: 'room' }), createDirectTextMessage: jest.fn().mockResolvedValue({ id: 'text' }), sendImageMessage: jest.fn() };
    const client = { id: 'synthetic-attachment-socket', connected: true, rooms: new Set(), data: {},
      handshake: { auth: { token: jwt.sign({ sid: syntheticSessionId, sub: 'sender' }, { expiresIn: 60 }) }, headers: {}, query: {} },
      use: jest.fn(), disconnect: jest.fn(), emit: jest.fn(), join: jest.fn() };
    const gateway = new MessagesGateway(jwt, { markOnline: jest.fn().mockReturnValue(false) } as unknown as MessagesPresenceService,
      messages as unknown as MessagesService, users as unknown as Repository<User>, sessionAccessStub());
    return { gateway, client: client as unknown as Socket, messages };
  }

  it.each([
    { label: 'image array', files: [{ name: 'synthetic.png', type: 'image/png', data: 'c3ludGhldGlj' }] },
    { label: 'non-image array', files: [{ name: 'synthetic.txt', type: 'text/plain', data: 'invalid-base64%' }] },
    { label: 'incomplete array', files: [{}] }, { label: 'null', files: null }, { label: 'malformed', files: 'malformed' },
  ])('rejects socket attachment payload $label before decode or partial text persistence', async ({ files }) => {
    const { gateway, client, messages } = socketFixture();
    try {
      await gateway.handleConnection(client);
      await expect(gateway.handleSendMessage(client, { roomId: 'room', text: 'must not partially persist', files } as Parameters<MessagesGateway['handleSendMessage']>[1]))
        .rejects.toMatchObject({ error: { status: 503, message: 'Image attachments are unavailable' } });
      expect(messages.getRoomOrFail).not.toHaveBeenCalled();
      expect(messages.createDirectTextMessage).not.toHaveBeenCalled();
      expect(messages.sendImageMessage).not.toHaveBeenCalled();
    } finally { gateway.onModuleDestroy(); }
  });

  it('continues accepting legacy text-only socket clients with an empty files array', async () => {
    const { gateway, client, messages } = socketFixture();
    try {
      await gateway.handleConnection(client);
      await expect(gateway.handleSendMessage(client, { roomId: 'room', text: 'text only', files: [] })).resolves.toMatchObject({ event: 'message:sent' });
      expect(messages.createDirectTextMessage).toHaveBeenCalledWith('room', 'sender', 'text only', undefined);
      expect(messages.sendImageMessage).not.toHaveBeenCalled();
    } finally { gateway.onModuleDestroy(); }
  });

  it.each(['emitRoomCleared', 'emitRoomDeleted'] as const)('%s reaches all authorized participant sockets without requiring room membership', async method => {
    const { gateway } = socketFixture();
    const access = (gateway as unknown as { access: SocketAccess }).access;
    const authorized = jest.spyOn(access, 'authorizedIds').mockImplementation(async userId => userId === 'a' ? ['a-tab1', 'a-tab2'] : userId === 'b' ? ['b-tab1'] : ['outsider']);
    const emit = jest.fn(), to = jest.fn().mockReturnValue({ emit });
    Object.defineProperty(gateway, 'server', { value: { to } });
    try {
      await gateway[method]('room', ['a', 'b', 'a']);
      expect(authorized.mock.calls).toEqual([['a'], ['b']]);
      expect(to).toHaveBeenCalledWith(['a-tab1', 'a-tab2', 'b-tab1']);
      expect(emit).toHaveBeenCalledWith(method === 'emitRoomCleared' ? 'room:cleared' : 'room:deleted', { roomId: 'room' });
    } finally { gateway.onModuleDestroy(); }
  });
});
