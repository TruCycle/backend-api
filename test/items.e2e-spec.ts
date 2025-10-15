/* eslint-disable import/no-unresolved */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { ItemGeocodingService } from '../src/modules/items/item-geocoding.service';
import { Item, ItemCondition, ItemStatus, ItemPickupOption } from '../src/modules/items/item.entity';
import { ItemsController } from '../src/modules/items/items.controller';
import { ItemsService } from '../src/modules/items/items.service';
import { User, UserStatus } from '../src/modules/users/user.entity';
import { Shop } from '../src/modules/shops/shop.entity';
import { Claim } from '../src/modules/claims/claim.entity';
import { KycProfile } from '../src/modules/users/kyc-profile.entity';
import { UserReview } from '../src/modules/reviews/user-review.entity';
import { QrImageService } from '../src/modules/qr/qr-image.service';
import { Co2EstimationService } from '../src/modules/items/co2-estimation.service';
import { ClaimsService } from '../src/modules/claims/claims.service';

class ServiceZone {}

describe('Items E2E', () => {
  let app: INestApplication;
  const itemRepo = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const userRepo = { findOne: jest.fn() };
  const zoneRepo = { createQueryBuilder: jest.fn() };
  const geocoding = { forwardGeocode: jest.fn() };
  const shopRepo = { find: jest.fn(), findOne: jest.fn() };
  const claimRepo = { find: jest.fn(), findOne: jest.fn(), createQueryBuilder: jest.fn() };
  const kycRepo = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
  const reviewRepo = { createQueryBuilder: jest.fn() };
  const qrImage = { generateAndUploadItemQrPng: jest.fn() };
  const co2 = { estimateSavedCo2Kg: jest.fn() };
  const claimsService = {} as ClaimsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ItemsController],
      providers: [
        ItemsService,
        { provide: ItemGeocodingService, useValue: geocoding },
        { provide: getRepositoryToken(Item), useValue: itemRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(ServiceZone), useValue: zoneRepo },
        { provide: getRepositoryToken(Shop), useValue: shopRepo },
        { provide: getRepositoryToken(Claim), useValue: claimRepo },
        { provide: getRepositoryToken(KycProfile), useValue: kycRepo },
        { provide: getRepositoryToken(UserReview), useValue: reviewRepo },
        { provide: QrImageService, useValue: qrImage },
        { provide: Co2EstimationService, useValue: co2 },
        { provide: ClaimsService, useValue: claimsService },
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
    const reflector = app.get(Reflector);
    app.useGlobalInterceptors(new ResponseInterceptor(reflector));
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
    Object.values(shopRepo).forEach((mock: any) => mock.mockReset?.());
    Object.values(claimRepo).forEach((mock: any) => mock.mockReset?.());
    Object.values(kycRepo).forEach((mock: any) => mock.mockReset?.());
    Object.values(reviewRepo).forEach((mock: any) => mock.mockReset?.());
    Object.values(qrImage).forEach((mock: any) => mock.mockReset?.());
    Object.values(co2).forEach((mock: any) => mock.mockReset?.());

    const genericQueryBuilder = () => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      having: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue(undefined),
    });

    claimRepo.createQueryBuilder.mockReturnValue(genericQueryBuilder());
    reviewRepo.createQueryBuilder.mockReturnValue(genericQueryBuilder());
    kycRepo.createQueryBuilder.mockReturnValue(genericQueryBuilder());
    qrImage.generateAndUploadItemQrPng.mockImplementation(async (id: string) =>
      `https://cdn.trucycle.com/qrs/item-${id}.png`,
    );
    co2.estimateSavedCo2Kg.mockResolvedValue(undefined);
    shopRepo.find.mockResolvedValue([]);
    shopRepo.findOne.mockResolvedValue(null);
  });

  it('GET /items/health returns success envelope', async () => {
    const res = await request(app.getHttpServer()).get('/items/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toEqual({ status: 'ok' });
  });

  it('GET /items/:id includes selected dropoff location details', async () => {
    const itemId = 'item-123';
    const dropoffId = 'shop-789';
    const itemEntity: any = {
      id: itemId,
      donor: null,
      status: ItemStatus.ACTIVE,
      title: 'Refillable Bottle',
      description: 'Reusable water bottle',
      pickupOption: ItemPickupOption.DONATE,
      estimatedCo2SavedKg: 1.5,
      postcode: 'E1 1AA',
      latitude: 51.515,
      longitude: -0.08,
      qrCodeUrl: 'https://cdn.trucycle.com/qrs/item-123.png',
      metadata: { color: 'blue' },
      images: [{ url: 'https://example.com/item.png', altText: 'Bottle' }],
      createdAt: new Date('2025-02-01T10:00:00Z'),
      dropoffLocationId: dropoffId,
    };
    const shopEntity: Shop = {
      id: dropoffId,
      owner: {} as User,
      name: 'Eco Hub',
      phoneNumber: '02071234567',
      addressLine: '123 Green Street',
      postcode: 'E1 1AA',
      operationalNotes: 'Open weekends',
      latitude: 51.514,
      longitude: -0.079,
      openingHours: { days: ['mon', 'tue'], open_time: '09:00', close_time: '17:00' },
      acceptableCategories: ['textiles'],
      geom: { type: 'Point', coordinates: [-0.079, 51.514] } as any,
      active: true,
      createdAt: new Date('2024-01-01T09:00:00Z'),
      updatedAt: new Date('2024-06-01T09:00:00Z'),
    };

    itemRepo.findOne.mockResolvedValue(itemEntity);
    itemRepo.query.mockResolvedValue([]);
    shopRepo.findOne.mockResolvedValue(shopEntity);

    const res = await request(app.getHttpServer()).get(`/items/${itemId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.id).toBe(itemId);
    expect(res.body.data.dropoff_location).toEqual({
      id: dropoffId,
      name: 'Eco Hub',
      phone_number: '02071234567',
      address_line: '123 Green Street',
      postcode: 'E1 1AA',
      operational_notes: 'Open weekends',
      latitude: 51.514,
      longitude: -0.079,
      opening_hours: { days: ['mon', 'tue'], open_time: '09:00', close_time: '17:00' },
      acceptable_categories: ['textiles'],
      active: true,
      created_at: '2024-01-01T09:00:00.000Z',
      updated_at: '2024-06-01T09:00:00.000Z',
    });
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
        size_unit: 'm',
        size_length: 1.8,
        size_breadth: 0.9,
        size_height: 0.75,
        weight_kg: 50,
        metadata: {
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
      estimated_co2_saved_kg: null,
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
    expect(geocoding.forwardGeocode).toHaveBeenCalledWith('EC1A 1BB');
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
