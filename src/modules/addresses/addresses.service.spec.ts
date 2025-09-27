import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { User } from '../users/user.entity';

import { Address } from './address.entity';
import { AddressesService } from './addresses.service';
import { ServiceZone } from './service-zone.entity';


function repoMock() {
  return {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

function qbMock() {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
  };
  return qb;
}

describe('AddressesService', () => {
  const addrRepo = repoMock();
  const zoneRepo = repoMock();
  const userRepo = repoMock();
  let service: AddressesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(Address), useValue: addrRepo },
        { provide: getRepositoryToken(ServiceZone), useValue: zoneRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();
    service = module.get(AddressesService);
  });

  it('rejects when user not found', async () => {
    userRepo.findOne.mockResolvedValue(undefined);
    await expect(
      service.create('missing', { latitude: 51.5, longitude: -0.1 } as any),
    ).rejects.toThrow('User not found');
  });

  it('rejects address outside London zone', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1' });
    const qb = qbMock();
    qb.getCount.mockResolvedValue(0);
    zoneRepo.createQueryBuilder.mockReturnValue(qb);
    await expect(
      service.create('u1', { latitude: 0, longitude: 0 } as any),
    ).rejects.toThrow('Address outside London service area');
  });

  it('creates an address inside London', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1' });
    const qb = qbMock();
    qb.getCount.mockResolvedValue(1);
    zoneRepo.createQueryBuilder.mockReturnValue(qb);
    addrRepo.create.mockImplementation((x: any) => x);
    addrRepo.save.mockImplementation(async (x: any) => ({ ...x, id: 'a1', createdAt: new Date() }));
    const res = await service.create('u1', { latitude: 51.5, longitude: -0.1 } as any);
    expect(res.id).toBe('a1');
  });
});

