import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { ServiceZone } from '../src/modules/addresses/service-zone.entity';
import { ItemGeocodingService } from '../src/modules/items/item-geocoding.service';
import { Item, ItemCondition, ItemStatus } from '../src/modules/items/item.entity';
import { ItemsController } from '../src/modules/items/items.controller';
import { ItemsService } from '../src/modules/items/items.service';
import { User, UserStatus } from '../src/modules/users/user.entity';

describe('Items E2E', () => {
  let app: INestApplication;
  const itemRepo = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const userRepo = { findOne: jest.fn() };
  const zoneRepo = { createQueryBuilder: jest.fn() };
  const geocoding = { forwardGeocode: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ItemsController],
      providers: [
        ItemsService,
        { provide: ItemGeocodingService, useValue: geocoding },
        { provide: getRepositoryToken(Item), useValue: itemRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(ServiceZone), useValue: zoneRepo },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { sub: 'user-1' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(itemRepo).forEach((mock: any) => mock.mockReset?.());
    Object.values(userRepo).forEach((mock: any) => mock.mockReset?.());
    Object.values(zoneRepo).forEach((mock: any) => mock.mockReset?.());
    Object.values(geocoding).forEach((mock: any) => mock.mockReset?.());
  });

  it('GET /items/health returns success envelope', async () => {
    const res = await request(app.getHttpServer()).get('/items/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toEqual({ status: 'ok' });
  });

  it('POST /items creates listing with derived status and geocoded location', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'user-1', status: UserStatus.ACTIVE });
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    };
    zoneRepo.createQueryBuilder.mockReturnValue(qb);
    geocoding.forwardGeocode.mockResolvedValue({ latitude: 51.5034, longitude: -0.1276 });
    itemRepo.create.mockImplementation((data: any) => ({ ...data }));
    itemRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      id: '9f5c2c8e',
      createdAt: new Date('2025-09-25T12:00:00Z'),
      qrCodeUrl: null,
    }));
    itemRepo.update.mockResolvedValue(undefined);

    const res = await request(app.getHttpServer())
      .post('/items')
      .set('Authorization', 'Bearer test-token')
      .send({
        title: 'Vintage Wooden Dining Table',
        description: 'Solid oak dining table',
        condition: 'good',
        category: 'furniture',
        address_line: '10 Downing Street, London',
        postcode: 'SW1A 2AA',
        pickup_option: 'donate',
        dropoff_location_id: '4c2b8db4-2d15-4c8e-92d2-81248b14d455',
        delivery_preferences: 'home_pickup',
        images: [
          { url: 'https://example.com/item1_img1.jpg', altText: 'Dining table front view' },
        ],
        metadata: {
          weight_kg: 50,
          dimensions_cm: '180x90x75',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(itemRepo.save).toHaveBeenCalledTimes(1);
    expect(itemRepo.update).toHaveBeenCalledWith('9f5c2c8e', {
      qrCodeUrl: 'https://cdn.trucycle.com/qrs/item-9f5c2c8e.png',
    });
    expect(res.body.data).toEqual({
      id: '9f5c2c8e',
      title: 'Vintage Wooden Dining Table',
      status: 'pending_dropoff',
      pickup_option: 'donate',
      location: {
        address_line: '10 Downing Street, London',
        postcode: 'SW1A 2AA',
        latitude: 51.5034,
        longitude: -0.1276,
      },
      qr_code: 'https://cdn.trucycle.com/qrs/item-9f5c2c8e.png',
      created_at: '2025-09-25T12:00:00.000Z',
    });
  });

  it('PATCH /items/:id updates listing for owner and revalidates geography', async () => {
    const existingItem: any = {
      id: '9f5c2c8e',
      donor: { id: 'user-1' },
      status: ItemStatus.ACTIVE,
      title: 'Vintage Wooden Dining Table',
      condition: ItemCondition.GOOD,
      category: 'furniture',
      addressLine: '10 Downing Street',
      postcode: 'SW1A 2AA',
      metadata: { weight_kg: 50 },
      images: [{ url: 'https://example.com/item1_img1.jpg', altText: 'Dining table front view' }],
      qrCodeUrl: 'https://cdn.trucycle.com/qrs/item-9f5c2c8e.png',
      latitude: 51.5034,
      longitude: -0.1276,
      location: { type: 'Point', coordinates: [-0.1276, 51.5034] },
    };
    itemRepo.findOne.mockResolvedValue(existingItem);
    geocoding.forwardGeocode.mockResolvedValue({ latitude: 51.5202, longitude: -0.0979 });
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    };
    zoneRepo.createQueryBuilder.mockReturnValue(qb);
    itemRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      updatedAt: new Date('2025-09-25T14:00:00Z'),
    }));

    const res = await request(app.getHttpServer())
      .patch('/items/9f5c2c8e')
      .set('Authorization', 'Bearer test-token')
      .send({
        title: 'Updated Dining Table',
        condition: 'fair',
        postcode: 'EC1A 1BB',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(geocoding.forwardGeocode).toHaveBeenCalledWith('10 Downing Street, EC1A 1BB');
    expect(zoneRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(itemRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Updated Dining Table',
        condition: ItemCondition.FAIR,
        postcode: 'EC1A 1BB',
        latitude: 51.5202,
        longitude: -0.0979,
      }),
    );
    expect(res.body.data).toEqual({
      id: '9f5c2c8e',
      title: 'Updated Dining Table',
      condition: 'fair',
      postcode: 'EC1A 1BB',
      latitude: 51.5202,
      longitude: -0.0979,
      updated_at: '2025-09-25T14:00:00.000Z',
    });
  });

  it('DELETE /items/:id removes listing owned by requester', async () => {
    const existingItem: any = {
      id: '9f5c2c8e',
      donor: { id: 'user-1' },
      status: ItemStatus.ACTIVE,
      title: 'Vintage Wooden Dining Table',
      condition: ItemCondition.GOOD,
      postcode: 'SW1A 2AA',
      latitude: 51.5034,
      longitude: -0.1276,
    };
    itemRepo.findOne.mockResolvedValue(existingItem);
    itemRepo.remove.mockResolvedValue(undefined);

    const res = await request(app.getHttpServer())
      .delete('/items/9f5c2c8e')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(204);
    expect(itemRepo.remove).toHaveBeenCalledWith(existingItem);
  });
});
