import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { User, UserStatus } from '../users/user.entity';
import { Role, RoleCode } from '../users/role.entity';
import { UserRole } from '../users/user-role.entity';
import { PasswordService } from '../../common/security/password.service';

interface JwtPayload {
  sub: string;
  email: string;
  roles: RoleCode[];
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    private readonly passwordService: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  private async getOrCreateRole(code: RoleCode): Promise<Role> {
    let role = await this.roles.findOne({ where: { code } });
    if (!role) {
      role = this.roles.create({ code });
      role = await this.roles.save(role);
    }
    return role;
  }

  async register(email: string, password: string, roleCode?: RoleCode) {
    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const hash = await this.passwordService.hash(password);
    const user = this.users.create({ email, passwordHash: hash, status: UserStatus.ACTIVE });
    const saved = await this.users.save(user);

    const code = roleCode || RoleCode.CUSTOMER;
    const role = await this.getOrCreateRole(code);
    const link = this.userRoles.create({ user: saved, role });
    await this.userRoles.save(link);

    const token = await this.issueToken(saved);
    return { user: await this.findUserWithRoles(saved.id), token };
  }

  async login(email: string, password: string) {
    const user = await this.users.findOne({ where: { email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    const ok = await this.passwordService.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('User is not active');

    const token = await this.issueToken(user);
    return { user: await this.findUserWithRoles(user.id), token };
  }

  private async issueToken(user: User): Promise<string> {
    const roles = await this.userRoles.find({ where: { user: { id: user.id } } });
    const roleCodes: RoleCode[] = roles.map((r) => r.role.code as RoleCode);
    const payload: JwtPayload = { sub: user.id, email: user.email, roles: roleCodes };
    return this.jwt.signAsync(payload);
  }

  private async findUserWithRoles(id: string) {
    const user = await this.users.findOne({ where: { id } });
    const links = await this.userRoles.find({ where: { user: { id } } });
    const roleCodes = links.map((l) => l.role.code);
    return {
      id: user!.id,
      email: user!.email,
      status: user!.status,
      roles: roleCodes,
      createdAt: user!.createdAt,
    };
  }
}

