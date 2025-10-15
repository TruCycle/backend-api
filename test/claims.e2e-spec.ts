import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { Claim, ClaimStatus } from '../src/modules/claims/claim.entity';
import { ClaimsController } from '../src/modules/claims/claims.controller';
import { ClaimsService } from '../src/modules/claims/claims.service';
import { Item, ItemStatus } from '../src/modules/items/item.entity';
import { RoleCode } from '../src/modules/users/role.entity';
import { User, UserStatus } from '../src/modules/users/user.entity';

describe('Claims E2E', () => {
  let app: INestApplication;
  let currentUser: any;

  const claimRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const itemRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const userRepo = {
    findOne: jest.fn(),
  };

  beforeAll(async () => {
    currentUser = { sub: 'collector-1', roles: [RoleCode.COLLECTOR] };

    const moduleRef = await Test.createTestingModule({
      controllers: [ClaimsController],
      providers: [
        ClaimsService,
        { provide: getRepositoryToken(Claim), useValue: claimRepo },
        { provide: getRepositoryToken(Item), useValue: itemRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = currentUser;
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
    Object.values(claimRepo).forEach((mock: any) => mock.mockReset?.());
    Object.values(itemRepo).forEach((mock: any) => mock.mockReset?.());
    Object.values(userRepo).forEach((mock: any) => mock.mockReset?.());
  });

  it('POST /claims creates a claim for an active collector', async () => {
    currentUser = { sub: 'collector-1', roles: [RoleCode.COLLECTOR] };

    const collector: Partial<User> = { id: 'collector-1', status: UserStatus.ACTIVE };
    userRepo.findOne.mockResolvedValue(collector);

    const item: Partial<Item> = {
      id: '9f5c2c8e-0000-4000-a000-000000000000',
      status: ItemStatus.ACTIVE,
      donor: { id: 'donor-1' } as any,
    };
    itemRepo.findOne.mockResolvedValue(item);

    claimRepo.findOne.mockResolvedValue(undefined);

    const createdAt = new Date('2025-09-25T12:10:00Z');
    claimRepo.create.mockImplementation((data: any) => ({ id: 'f2a8471d', createdAt, ...data }));
    claimRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      id: 'f2a8471d',
      createdAt,
    }));

    const res = await request(app.getHttpServer())
      .post('/claims')
      .set('Authorization', 'Bearer fake-token')
      .send({ item_id: '9f5c2c8e-0000-4000-a000-000000000000' });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: 'f2a8471d',
      item_id: '9f5c2c8e-0000-4000-a000-000000000000',
      collector_id: 'collector-1',
      status: 'pending_approval',
      created_at: '2025-09-25T12:10:00.000Z',
    });
    expect(itemRepo.update).not.toHaveBeenCalled();
  });

  it('POST /claims allows customers (treated as collectors)', async () => {
    currentUser = { sub: 'customer-1', roles: [RoleCode.CUSTOMER] };

    const customer: Partial<User> = { id: 'customer-1', status: UserStatus.ACTIVE };
    userRepo.findOne.mockResolvedValue(customer);

    const item: Partial<Item> = {
      id: '9f5c2c8e-0000-4000-a000-000000000000',
      status: ItemStatus.ACTIVE,
      donor: { id: 'donor-1' } as any,
    };
    itemRepo.findOne.mockResolvedValue(item);

    claimRepo.findOne.mockResolvedValue(undefined);

    const createdAt = new Date('2025-09-25T12:10:00Z');
    claimRepo.create.mockImplementation((data: any) => ({ id: 'f2a8471d', createdAt, ...data }));
    claimRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      id: 'f2a8471d',
      createdAt,
    }));

    const res = await request(app.getHttpServer())
      .post('/claims')
      .set('Authorization', 'Bearer fake-token')
      .send({ item_id: '9f5c2c8e-0000-4000-a000-000000000000' });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: 'f2a8471d',
      item_id: '9f5c2c8e-0000-4000-a000-000000000000',
      collector_id: 'customer-1',
      status: 'pending_approval',
      created_at: '2025-09-25T12:10:00.000Z',
    });
    expect(itemRepo.update).not.toHaveBeenCalled();
  });

  it('POST /claims prevents duplicate active claims', async () => {
    currentUser = { sub: 'collector-2', roles: [RoleCode.COLLECTOR] };

    const collector: Partial<User> = { id: 'collector-2', status: UserStatus.ACTIVE };
    userRepo.findOne.mockResolvedValue(collector);
    const item: Partial<Item> = {
      id: '9f5c2c8e-0000-4000-a000-000000000000',
      status: ItemStatus.ACTIVE,
      donor: { id: 'donor-1' } as any,
    };
    itemRepo.findOne.mockResolvedValue(item);
    claimRepo.findOne.mockResolvedValue({ id: 'existing-claim' });

    const res = await request(app.getHttpServer())
      .post('/claims')
      .set('Authorization', 'Bearer fake-token')
      .send({ item_id: '9f5c2c8e-0000-4000-a000-000000000000' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('This item already has an active claim');
  });

  it('PATCH /claims/:id/approve approves pending claim for admin', async () => {
    currentUser = { sub: 'admin-1', roles: [RoleCode.ADMIN] };
    const claim: Partial<Claim> = { id: 'f2a8471d', status: ClaimStatus.PENDING_APPROVAL };
    claimRepo.findOne.mockResolvedValue(claim);
    const approvedAt = new Date('2025-09-25T12:15:00Z');
    claimRepo.save.mockImplementation(async (entity: any) => ({
      ...entity,
      approvedAt,
    }));

    const res = await request(app.getHttpServer())
      .patch('/claims/f2a8471d/approve')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: 'f2a8471d',
      status: 'approved',
      approved_at: '2025-09-25T12:15:00.000Z',
    });
  });

  it('PATCH /claims/:id/approve rejects when claim already processed', async () => {
    currentUser = { sub: 'admin-1', roles: [RoleCode.ADMIN] };
    const claim: Partial<Claim> = { id: 'f2a8471d', status: ClaimStatus.APPROVED };
    claimRepo.findOne.mockResolvedValue(claim);

    const res = await request(app.getHttpServer())
      .patch('/claims/f2a8471d/approve')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Only pending claims can be approved');
  });

  it('PATCH /claims/:id/approve forbids non-admin users', async () => {
    currentUser = { sub: 'collector-1', roles: [RoleCode.COLLECTOR] };

    claimRepo.findOne.mockResolvedValue({
      id: 'f2a8471d',
      status: ClaimStatus.PENDING_APPROVAL,
      item: { donor: { id: 'donor-1' } } as any,
    });

    const res = await request(app.getHttpServer())
      .patch('/claims/f2a8471d/approve')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Only the donor or an admin may approve this claim');
  });
});
