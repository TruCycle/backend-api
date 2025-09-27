import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { Address } from '../src/modules/addresses/address.entity';
import { AddressesController } from '../src/modules/addresses/addresses.controller';
import { AddressesService } from '../src/modules/addresses/addresses.service';
import { ServiceZone } from '../src/modules/addresses/service-zone.entity';
import { User } from '../src/modules/users/user.entity';

// Integration-style test with mocked repos + guard
describe('Addresses E2E (mocked DB + auth)', () => {
  let app: INestApplication;
  const addrRepo = { create: jest.fn(), save: jest.fn() };
  const zoneRepo = { createQueryBuilder: jest.fn() };
  const userRepo = { findOne: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [],
      controllers: [AddressesController],
      providers: [
        AddressesService,
        { provide: getRepositoryToken(Address), useValue: addrRepo },
        { provide: getRepositoryToken(ServiceZone), useValue: zoneRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { sub: 'u1' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /addresses validates London zone and creates address', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1' });
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    };
    zoneRepo.createQueryBuilder.mockReturnValue(qb);
    addrRepo.create.mockImplementation((x: any) => x);
    addrRepo.save.mockResolvedValue({ id: 'addr1', createdAt: new Date() });

    const res = await request(app.getHttpServer())
      .post('/addresses')
      .set('Authorization', 'Bearer test')
      .send({ latitude: 51.5, longitude: -0.12, label: 'Home' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.id).toBe('addr1');
  });
});
