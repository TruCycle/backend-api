import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PasswordService } from '../../common/security/password.service';
import { EmailService } from '../notifications/email.service';
import { Role, RoleCode } from '../users/role.entity';
import { normalizeIncomingRole } from '../users/role.utils';
import { UserRole } from '../users/user-role.entity';
import { User, UserStatus } from '../users/user.entity';
import { KycProfile, KycStatus } from '../users/kyc-profile.entity';
import { Shop } from '../shops/shop.entity';
import { CreateShopDto } from '../shops/dto/create-shop.dto';

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
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(KycProfile) private readonly kycs: Repository<KycProfile>,
    private readonly passwordService: PasswordService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  // Minimal internal geocoder to prioritise postcode/address over lat/lng during shop creation
  private async geocodeAddress(query: string): Promise<{ latitude: number; longitude: number }> {
    const trimmed = (query ?? '').trim();
    if (!trimmed) throw new BadRequestException('Address information is required');

    const endpoint = process.env.OSM_SEARCH_URL || 'https://nominatim.openstreetmap.org/search';
    const userAgent = process.env.OSM_USER_AGENT || 'TruCycleBackend/0.1 (+https://trucycle.com/contact)';
    const timeoutMs = Number(process.env.OSM_TIMEOUT_MS || 5000);

    const fetchFn: any = (globalThis as any).fetch;
    if (typeof fetchFn !== 'function') throw new Error('Geocoder unavailable');

    const AbortCtor: any = (globalThis as any).AbortController;
    const controller = typeof AbortCtor === 'function' ? new AbortCtor() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const params = new URLSearchParams({ q: trimmed, format: 'jsonv2', limit: '1', addressdetails: '0' });
      const url = `${endpoint}?${params.toString()}`;
      const res = await fetchFn(url, {
        method: 'GET',
        headers: { 'User-Agent': userAgent, Accept: 'application/json', 'Accept-Language': 'en' },
        signal: controller ? controller.signal : undefined,
      });
      if (!res || !res.ok) throw new Error(`Geocoder responded with status ${res?.status}`);
      const payload: any = await res.json();
      if (!Array.isArray(payload) || payload.length === 0) {
        throw new BadRequestException('Unable to geocode the supplied address');
      }
      const latitude = Number(payload[0]?.lat);
      const longitude = Number(payload[0]?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new BadRequestException('Geocoder returned invalid coordinates');
      }
      return { latitude, longitude };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

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
    shopDto?: CreateShopDto,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.users.findOne({ where: { email: normalizedEmail } });
    if (existing) {
      // If a user re-registers without shop details, return a simple duplicate message
      if (!shopDto) {
        throw new ConflictException('Email already registered');
      }
      // If they included shop details (attempting partner), direct them to the upgrade endpoint
      throw new ConflictException('Email already registered. Please log in and use the upgrade-to-partner endpoint.');
    }

    const hash = await this.passwordService.hash(password);
    const user = this.users.create({
      email: normalizedEmail,
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      passwordHash: hash,
      status: UserStatus.PENDING,
    });
    const saved = await this.users.save(user);

    // If a shop payload is provided, default to PARTNER role
    const inferredRole = roleCode ?? (shopDto ? RoleCode.PARTNER : undefined);
    const code = normalizeIncomingRole(inferredRole || RoleCode.CUSTOMER);

    // Enforce: Partner role requires at least one shop
    let createdShop: any | undefined;
    if (code === RoleCode.PARTNER) {
      if (!shopDto) {
        throw new BadRequestException('Shop details are required to register as a partner');
      }
      // Geocode using postcode only (postcode has priority)
      const located = await this.geocodeAddress(shopDto.postcode);
      const lat = Number(located.latitude);
      const lon = Number(located.longitude);
      const shop = this.shops.create({
        owner: saved,
        name: shopDto.name,
        phoneNumber: shopDto.phoneNumber,
        addressLine: shopDto.addressLine,
        postcode: shopDto.postcode,
        latitude: lat,
        longitude: lon,
        openingHours: shopDto.openingHours
          ? { days: shopDto.openingHours.days, open_time: shopDto.openingHours.open_time, close_time: shopDto.openingHours.close_time }
          : undefined,
        acceptableCategories: shopDto.acceptableCategories,
        geom: { type: 'Point', coordinates: [lon, lat] } as any,
      });
      const savedShop = await this.shops.save(shop);
      createdShop = this.viewShop(savedShop);
    }

    // Link role after enforcing partner shop requirement
    const role = await this.getOrCreateRole(code);
    const link = this.userRoles.create({ user: saved, role });
    await this.userRoles.save(link);

    // Issue an access token (kept for backward compatibility/tests)
    const token = await this.issueToken(saved);

    // Generate a time-limited email verification token and send email
    await this.sendVerificationEmail(saved);

    return { user: await this.findUserWithRoles(saved.id), token, shop: createdShop };
  }

  async upgradeToPartner(authPayload: any, shopDto?: CreateShopDto) {
    if (!authPayload || typeof authPayload.sub !== 'string') {
      throw new UnauthorizedException('Authenticated user context not found');
    }
    const userId = authPayload.sub.trim();
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User record not found');

    // Enforce: must have at least one shop to be partner
    const existingShops = await this.shops.count({ where: { owner: { id: user.id } } });
    let createdShop: any | undefined;
    if (existingShops === 0 && !shopDto) {
      throw new BadRequestException('Shop details are required to upgrade to partner');
    }

    if (shopDto) {
      // Geocode using postcode only (postcode has priority)
      const located = await this.geocodeAddress(shopDto.postcode);
      const lat = Number(located.latitude);
      const lon = Number(located.longitude);
      const shop = this.shops.create({
        owner: user,
        name: shopDto.name,
        phoneNumber: shopDto.phoneNumber,
        addressLine: shopDto.addressLine,
        postcode: shopDto.postcode,
        latitude: lat,
        longitude: lon,
        openingHours: shopDto.openingHours
          ? { days: shopDto.openingHours.days, open_time: shopDto.openingHours.open_time, close_time: shopDto.openingHours.close_time }
          : undefined,
        acceptableCategories: shopDto.acceptableCategories,
        geom: { type: 'Point', coordinates: [lon, lat] } as any,
      });
      const savedShop = await this.shops.save(shop);
      createdShop = this.viewShop(savedShop);
    }

    // Link partner role now (after ensuring shop requirement)
    const partnerRole = await this.getOrCreateRole(RoleCode.PARTNER);
    const links = await this.userRoles.find({ where: { user: { id: user.id } } });
    const hasPartner = links.some((l) => l.role.code === partnerRole.code);
    if (!hasPartner) {
      const link = this.userRoles.create({ user, role: partnerRole });
      await this.userRoles.save(link);
    }

    // Return updated user (with roles), optional created shop, and refreshed tokens including new roles
    const updatedUser = await this.findUserWithRoles(user.id);
    const accessToken = await this.issueToken(user);
    const refreshToken = await this.issueRefreshToken(user);
    const tokens = {
      accessToken,
      refreshToken,
      accessTokenExpiry: this.getExpiryFromJwt(accessToken),
      refreshTokenExpiry: this.getExpiryFromJwt(refreshToken),
    };
    return { user: updatedUser, shop: createdShop, tokens };
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

  async verifyUser(token: string) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch (_err) {
      // Do not leak whether token exists or expired specifics
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Basic sanity checks on token payload
    if (!payload || payload.type !== 'verify' || !payload.sub) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const uid = payload.sub as string;
    const user = await this.users.findOne({ where: { id: uid } });
    if (!user) {
      // Generic error to avoid leaking existence
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Optional: ensure token email matches user email if present
    if (payload.email && payload.email !== user.email) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // If user is deleted or suspended, do not proceed
    if (user.status === UserStatus.DELETED || user.status === UserStatus.SUSPENDED) {
      throw new BadRequestException('Account not eligible for verification');
    }

    // Activate pending users
    if (user.status === UserStatus.PENDING) {
      user.status = UserStatus.ACTIVE;
      await this.users.save(user);
    }

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
    const verifyUrl = `${appBase.replace(/\/$/, '')}/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;
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

  async getBasicProfileById(id: string) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new UnauthorizedException('Invalid token');
    const links = await this.userRoles.find({ where: { user: { id } } });
    const roles = links.map((l) => l.role.code);
    // Build verification flags
    const kyc = await this.kycs.findOne({ where: { user: { id } }, relations: { user: true } });
    let addressVerified = false;
    try {
      const rows: any[] = await this.users.query('SELECT COUNT(1) AS cnt FROM address WHERE user_id = $1', [id]);
      addressVerified = Number(rows?.[0]?.cnt || 0) > 0;
    } catch {
      addressVerified = false;
    }
    return {
      id: user.id,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      email: user.email,
      postcode: user.postcode ?? null,
      status: user.status,
      roles,
      verifications: {
        email_verified: user.status === UserStatus.ACTIVE,
        identity_verified: kyc?.status === KycStatus.APPROVED,
        address_verified: addressVerified,
      },
    };
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

  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.users.findOne({ where: { email: normalizedEmail } });
    // Do not reveal whether the user exists; send only for eligible accounts
    if (user && user.status !== UserStatus.DELETED) {
      await this.sendResetPasswordEmail(user);
    }
    // Controller always returns success
  }

  private async sendResetPasswordEmail(user: User) {
    const appBase = process.env.APP_BASE_URL || 'http://localhost:3000';
    const expiresIn = process.env.JWT_RESET_EXPIRES_IN || '1h';
    const resetToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, type: 'reset' },
      { expiresIn },
    );
    const resetUrl = `${appBase.replace(/\/$/, '')}/auth/reset-password?token=${encodeURIComponent(resetToken)}`;
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
        <p>Hello${user.firstName ? ' ' + user.firstName : ''},</p>
        <p>We received a request to reset your password. If this was you, click the button below to set a new password.</p>
        <p><a href="${resetUrl}" target="_blank" style="background:#0f766e;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">Reset Password</a></p>
        <p>Or copy this link into your browser:<br/>
          <code>${resetUrl}</code>
        </p>
        <p>This link expires in ${expiresIn}. If you did not request a password reset, you can safely ignore this email.</p>
      </div>
    `;
    await this.email.sendEmail({ to: user.email, subject: 'Reset your password', html });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch (_err) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!payload || payload.type !== 'reset' || !payload.sub) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const uid: string = payload.sub;

    const user = await this.users.findOne({ where: { id: uid } });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.email && payload.email !== user.email) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (user.status === UserStatus.DELETED || user.status === UserStatus.SUSPENDED) {
      throw new BadRequestException('Account not eligible for password reset');
    }

    const hash = await this.passwordService.hash(newPassword);
    user.passwordHash = hash;
    await this.users.save(user);

    // Optional: notify user about password change
    try {
      await this.email.sendEmail({
        to: user.email,
        subject: 'Your password was changed',
        html: `<p>Hello${user.firstName ? ' ' + user.firstName : ''},</p><p>Your account password was just changed. If this wasn't you, please contact support immediately.</p>`,
      });
    } catch {
      // Non-fatal if email fails
    }
  }

  private viewShop(s: Shop) {
    return {
      id: s.id,
      name: s.name,
      phone_number: s.phoneNumber ?? null,
      address_line: s.addressLine,
      postcode: s.postcode,
      latitude: s.latitude,
      longitude: s.longitude,
      opening_hours: s.openingHours ?? null,
      acceptable_categories: s.acceptableCategories ?? [],
      active: s.active,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    };
  }
}
