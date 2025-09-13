import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { User, UserStatus } from '../users/user.entity';
import { Role, RoleCode } from '../users/role.entity';
import { UserRole } from '../users/user-role.entity';
import { PasswordService } from '../../common/security/password.service';
import { EmailService } from '../notifications/email.service';

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
    private readonly email: EmailService,
  ) {}

  private async getOrCreateRole(code: RoleCode): Promise<Role> {
    let role = await this.roles.findOne({ where: { code } });
    if (!role) {
      role = this.roles.create({ code });
      role = await this.roles.save(role);
    }
    return role;
  }

  async register(
    email: string,
    password: string,
    roleCode?: RoleCode,
    firstName?: string,
    lastName?: string,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.users.findOne({ where: { email: normalizedEmail } });
    if (existing) throw new ConflictException('Email already registered');

    const hash = await this.passwordService.hash(password);
    const user = this.users.create({
      email: normalizedEmail,
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      passwordHash: hash,
      status: UserStatus.PENDING,
    });
    const saved = await this.users.save(user);

    const code = roleCode || RoleCode.CUSTOMER;
    const role = await this.getOrCreateRole(code);
    const link = this.userRoles.create({ user: saved, role });
    await this.userRoles.save(link);

    // Issue an access token (kept for backward compatibility/tests)
    const token = await this.issueToken(saved);

    // Generate a time-limited email verification token and send email
    await this.sendVerificationEmail(saved);

    return { user: await this.findUserWithRoles(saved.id), token };
  }

  async login(email: string, password: string) {
    const user = await this.users.findOne({ where: { email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    const ok = await this.passwordService.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('User is not active');

    const accessToken = await this.issueToken(user);
    const refreshToken = await this.issueRefreshToken(user);
    const tokens = {
      accessToken,
      refreshToken,
      accessTokenExpiry: this.getExpiryFromJwt(accessToken),
      refreshTokenExpiry: this.getExpiryFromJwt(refreshToken),
    };

    return { user: await this.findUserWithRoles(user.id), tokens };
  }

  private async issueToken(user: User): Promise<string> {
    const roles = await this.userRoles.find({ where: { user: { id: user.id } } });
    const roleCodes: RoleCode[] = roles.map((r) => r.role.code as RoleCode);
    const payload: JwtPayload = { sub: user.id, email: user.email, roles: roleCodes };
    return this.jwt.signAsync(payload);
  }

  private async issueRefreshToken(user: User): Promise<string> {
    const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
    const payload = { sub: user.id, email: user.email, type: 'refresh' };
    return this.jwt.signAsync(payload, { expiresIn: refreshExpiresIn });
  }

  private getExpiryFromJwt(token: string): string | null {
    const decoded: any = this.jwt.decode(token);
    if (decoded && typeof decoded === 'object' && decoded.exp) {
      return new Date(decoded.exp * 1000).toISOString();
    }
    return null;
  }

  private async findUserWithRoles(id: string) {
    const user = await this.users.findOne({ where: { id } });
    const links = await this.userRoles.find({ where: { user: { id } } });
    const roleCodes = links.map((l) => l.role.code);
    return {
      id: user!.id,
      firstName: user!.firstName ?? null,
      lastName: user!.lastName ?? null,
      email: user!.email,
      status: user!.status,
      roles: roleCodes,
      createdAt: user!.createdAt,
    };
  }

  private async sendVerificationEmail(user: User) {
    const appBase = process.env.APP_BASE_URL || 'http://localhost:3000';
    const verifyToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, type: 'verify' },
      { expiresIn: '24h' },
    );
    const verifyUrl = `${appBase.replace(/\/$/, '')}/auth/verify-email?token=${encodeURIComponent(
      verifyToken,
    )}`;
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
        <p>Hello${user.firstName ? ' ' + user.firstName : ''},</p>
        <p>Welcome! Please verify your email address to activate your account.</p>
        <p><a href="${verifyUrl}" target="_blank" style="background:#0f766e;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">Verify Email</a></p>
        <p>Or copy this link into your browser:<br/>
          <code>${verifyUrl}</code>
        </p>
        <p>This link expires in 24 hours. If you did not request this, you can ignore this email.</p>
      </div>
    `;
    await this.email.sendEmail({ to: user.email, subject: 'Verify your email', html });
  }

  async resendVerification(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    // Look up user; avoid leaking existence or state
    const user = await this.users.findOne({ where: { email: normalizedEmail } });
    if (user && user.status === UserStatus.PENDING) {
      await this.sendVerificationEmail(user);
    }
    // Always return success from controller to prevent user enumeration
  }
}
