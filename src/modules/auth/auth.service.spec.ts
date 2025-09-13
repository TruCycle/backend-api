import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User, UserStatus } from '../users/user.entity';
import { Role, RoleCode } from '../users/role.entity';
import { UserRole } from '../users/user-role.entity';
import { PasswordService } from '../../common/security/password.service';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../notifications/email.service';

function repoMock() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
}

describe('AuthService', () => {
  let service: AuthService;
  const userRepo = repoMock();
  const roleRepo = repoMock();
  const userRoleRepo = repoMock();
  const password = new PasswordService();
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('jwt-token'),
    decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  } as unknown as JwtService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordService,
        { provide: JwtService, useValue: jwt },
        { provide: EmailService, useValue: { sendEmail: jest.fn().mockResolvedValue(undefined) } },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Role), useValue: roleRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('registers a new user and returns token', async () => {
    jest.spyOn<any, any>(service as any, 'issueToken').mockResolvedValue('jwt-token');
    userRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.email) return undefined; // no existing
      if (where?.id) return { id: 'u1', email: 'a@b.com', status: UserStatus.ACTIVE, createdAt: new Date() };
      return undefined;
    });
    userRepo.create.mockImplementation((x: any) => x);
    userRepo.save.mockImplementation(async (x: any) => ({ ...x, id: 'u1', createdAt: new Date() }));
    roleRepo.findOne.mockResolvedValue({ id: 'r1', code: RoleCode.CUSTOMER });
    userRoleRepo.create.mockImplementation((x: any) => x);
    userRoleRepo.save.mockResolvedValue({ id: 'ur1' });
    userRoleRepo.find = jest.fn().mockResolvedValue([{ role: { code: RoleCode.CUSTOMER } }]);

    const res = await service.register('a@b.com', 'Password123!', undefined);
    expect(res.user.email).toBe('a@b.com');
    expect(res.token).toBe('jwt-token');
  });

  it('fails to register duplicate email', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'exists' });
    await expect(service.register('a@b.com', 'Password123!')).rejects.toThrow('Email already registered');
  });

  it('logs in a user successfully', async () => {
    jest.spyOn<any, any>(service as any, 'issueToken').mockResolvedValue('jwt-token');
    // set a known hash for Password123!
    const hash = await password.hash('Password123!');
    userRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.email) return { id: 'u1', email: 'a@b.com', passwordHash: hash, status: UserStatus.ACTIVE };
      if (where?.id) return { id: 'u1', email: 'a@b.com', status: UserStatus.ACTIVE, createdAt: new Date() };
      return undefined;
    });
    userRoleRepo.find = jest.fn().mockResolvedValue([{ role: { code: RoleCode.CUSTOMER } }]);
    const res = await service.login('a@b.com', 'Password123!');
    expect(res.tokens.accessToken).toBe('jwt-token');
    expect(res.tokens.refreshToken).toBe('jwt-token');
  });

  it('rejects invalid credentials', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash: 'nope', status: UserStatus.ACTIVE });
    await expect(service.login('a@b.com', 'wrong')).rejects.toThrow('Invalid credentials');
  });
});
