import { BadRequestException, ConflictException, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { randomInt } from 'crypto';
import { OAuth2Client } from 'google-auth-library';

import { PasswordService } from '../../common/security/password.service';
import { frontendOrigin } from '../../common/utils/frontend-origin';
import { EmailService } from '../notifications/email.service';
import {
  buildPasswordResetOtpEmailTemplate,
  buildPasswordResetSuccessEmailTemplate,
  buildVerifyEmailTemplate,
  buildWelcomeEmailTemplate,
} from '../notifications/email-templates';
import { Role, RoleCode } from '../users/role.entity';
import { normalizeIncomingRole } from '../users/role.utils';
import { UserRole } from '../users/user-role.entity';
import { User, UserStatus } from '../users/user.entity';
import { KycProfile, KycStatus } from '../users/kyc-profile.entity';
import { Shop } from '../shops/shop.entity';
import { CreateShopDto } from '../shops/dto/create-shop.dto';
import { normalizeShopIdentity, withShopOwnerLock, assertNoDuplicateShop } from '../shops/shop-validation';
import { AuthSessionsService } from './auth-sessions.service';
import { AuthEmailOutboxService } from './auth-email-outbox.service';
import { ItemGeocodingService } from '../items/item-geocoding.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(KycProfile) private readonly kycs: Repository<KycProfile>,
    private readonly passwordService: PasswordService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly sessions: AuthSessionsService,
    private readonly geocoding: ItemGeocodingService,
    @Optional() private readonly authEmailOutbox?: AuthEmailOutboxService,
  ) {}

  private async geocodeAddress(query: string): Promise<{ latitude: number; longitude: number }> {
    const point = await this.geocoding.forwardGeocode(query);
    return { latitude: point.latitude, longitude: point.longitude };
  }

  private async getOrCreateRole(code: RoleCode): Promise<Role> {
    const role = await this.roles.findOne({ where: { code } });
    if (role) return role;
    try { return await this.roles.save(this.roles.create({ code })); }
    catch (error) {
      // Outside the account transaction: recover only a concurrent role insert.
      if ((error as { code?: string })?.code !== '23505') throw error;
      const winner = await this.roles.findOne({ where: { code } });
      if (!winner) throw error;
      return winner;
    }
  }

  async register(email: string, password: string, roleCode?: RoleCode, firstName?: string, lastName?: string, shopDto?: CreateShopDto) {
    const normalizedEmail = email.trim().toLowerCase();
    const requestedRole = String(roleCode ?? '').trim().toLowerCase();
    if (requestedRole && !['customer', 'collector', 'partner', 'donor'].includes(requestedRole)) {
      throw new BadRequestException('This role cannot be requested through public registration');
    }
    const code = normalizeIncomingRole(roleCode ?? (shopDto ? RoleCode.PARTNER : RoleCode.CUSTOMER));
    if (code === RoleCode.PARTNER && !shopDto) throw new BadRequestException('Shop details are required to register as a partner');
    const identity = shopDto && code === RoleCode.PARTNER ? normalizeShopIdentity(shopDto) : undefined;
    if (await this.users.findOne({ where: { email: normalizedEmail } })) throw new ConflictException('Email already registered. Please log in or use account recovery.');
    const location = identity ? await this.geocodeAddress(identity.postcode) : undefined;
    const hash = await this.passwordService.hash(password);
    const role = await this.getOrCreateRole(code);
    let created: { user: User; shop?: Shop; queued?: boolean };
    try {
      created = await this.users.manager.transaction(async manager => {
        const users = manager.getRepository(User);
        const saved = await users.save(users.create({ email: normalizedEmail, firstName: firstName?.trim(), lastName: lastName?.trim(), passwordHash: hash, status: UserStatus.PENDING }));
        let shop: Shop | undefined;
        if (identity && location && shopDto) {
          // The pending-owner exception applies only to this newly-created user.
          shop = await withShopOwnerLock(manager, saved.id, async (tx, owner) => {
            await assertNoDuplicateShop(tx, owner.id, identity);
            const shops = tx.getRepository(Shop);
            return shops.save(shops.create({ owner, ...identity, phoneNumber: shopDto.phoneNumber,
              latitude: location.latitude, longitude: location.longitude,
              openingHours: shopDto.openingHours ? { days: shopDto.openingHours.days, open_time: shopDto.openingHours.open_time, close_time: shopDto.openingHours.close_time } : undefined,
              acceptableCategories: shopDto.acceptableCategories, geom: { type: 'Point', coordinates: [location.longitude, location.latitude] } }));
          }, { allowInactiveOwner: true });
        }
        const links = manager.getRepository(UserRole);
        await links.save(links.create({ user: saved, role }));
        return { user: saved, shop, queued: await this.queueVerification(manager, saved) };
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') throw new ConflictException('Email already registered. Please log in or use account recovery.');
      throw error;
    }
    const verificationDelivery = created.queued ? { status: 'queued' as const } : await this.sendVerificationEmail(created.user);
    await this.sendWelcomeEmail(created.user);
    return { user: await this.findUserWithRoles(created.user.id), shop: created.shop ? this.viewShop(created.shop) : undefined, verificationDelivery };
  }

  async upgradeToPartner(authPayload: any, shopDto?: CreateShopDto) {
    const userId = typeof authPayload?.sub === 'string' ? authPayload.sub.trim() : '';
    if (!userId) throw new UnauthorizedException('Authenticated user context not found');
    const identity = shopDto ? normalizeShopIdentity(shopDto) : undefined;
    const location = identity ? await this.geocodeAddress(identity.postcode) : undefined;
    const partnerRole = await this.getOrCreateRole(RoleCode.PARTNER);
    const createdShop = await withShopOwnerLock(this.users.manager, userId, async (manager, user) => {
      const shops = manager.getRepository(Shop);
      if (!identity && !await shops.count({ where: { owner: { id: userId }, active: true } })) throw new BadRequestException('Shop details are required to upgrade to partner');
      let shop: Shop | undefined;
      if (identity && location && shopDto) {
        await assertNoDuplicateShop(manager, userId, identity);
        shop = await shops.save(shops.create({ owner: user, ...identity, phoneNumber: shopDto.phoneNumber,
          latitude: location.latitude, longitude: location.longitude,
          openingHours: shopDto.openingHours ? { days: shopDto.openingHours.days, open_time: shopDto.openingHours.open_time, close_time: shopDto.openingHours.close_time } : undefined,
          acceptableCategories: shopDto.acceptableCategories, geom: { type: 'Point', coordinates: [location.longitude, location.latitude] } }));
      }
      const links = manager.getRepository(UserRole);
      const existing = await links.find({ where: { user: { id: user.id } } });
      if (!existing.some(link => link.role.code === RoleCode.PARTNER)) await links.save(links.create({ user, role: partnerRole }));
      return shop;
    });
    return { user: await this.findUserWithRoles(userId), shop: createdShop ? this.viewShop(createdShop) : undefined };
  }

  async login(email: string, password: string) {
    const user = await this.users.findOne({ where: { email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    const checkedPasswordHash = user.passwordHash;
    const ok = await this.passwordService.compare(password, checkedPasswordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('User is not active');

    const tokens = await this.sessions.create(user.id, { passwordHash: checkedPasswordHash });

    return { user: await this.findUserWithRoles(user.id), tokens };
  }

  async refreshTokens(refreshToken: string) {
    const { userId, tokens } = await this.sessions.refresh(refreshToken);
    return { user: await this.findUserWithRoles(userId), tokens };
  }

  async logout(refreshToken?: string, accessToken?: string): Promise<void> {
    if (!refreshToken && !accessToken) throw new BadRequestException('A session credential is required');
    await this.sessions.revoke(refreshToken || accessToken!, refreshToken ? 'refresh' : 'access');
  }
  async logoutAll(userId: string): Promise<void> { await this.sessions.revokeAll(userId); }
  async verifyUser(token: string) {
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch (_err) {
      // Do not leak whether token exists or expired specifics
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Basic sanity checks on token payload
    if (!payload || payload.type !== 'verify' || typeof payload.sub !== 'string' || !payload.sub.trim() || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp * 1000) || payload.exp * 1000 <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const uid = payload.sub;
    return this.users.manager.transaction(async manager => {
      const users = manager.getRepository(User);
      const user = await users.findOne({ where: { id: uid }, loadEagerRelations: false, lock: { mode: 'pessimistic_write' } });
      // Recheck after the row lock. No provider work inside this transaction.
      if (!user || (payload.exp as number) * 1000 <= Date.now() ||
          typeof payload.email !== 'string' || payload.email !== user.email) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      if (![UserStatus.PENDING, UserStatus.ACTIVE].includes(user.status)) {
        throw new BadRequestException('Account not eligible for verification');
      }
      if (user.status === UserStatus.PENDING) {
        user.status = UserStatus.ACTIVE;
        await users.save(user);
      }
      await this.authEmailOutbox?.discard(manager, user.id, 'verification');
      // Verification cannot mint sessions or replace a signed-in account.
      return { verified: true as const };
    });
  }

  private googleClient?: OAuth2Client;

  private getGoogleClient(): OAuth2Client {
    if (!this.googleClient) {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) {
        throw new BadRequestException('Google sign-in is not configured');
      }
      this.googleClient = new OAuth2Client(clientId);
    }
    return this.googleClient;
  }

  /**
   * Sign in (or sign up) with a Google ID token issued to our web client by
   * Google Identity Services. Verifies the token, then finds the user by
   * google_id or verified email, creating a customer account on first use.
   */
  async loginWithGoogle(idToken: string) {
    const token = (idToken ?? '').trim();
    if (!token) throw new UnauthorizedException('Missing Google credential');

    const clientId = process.env.GOOGLE_CLIENT_ID;
    let ticket;
    try {
      ticket = await this.getGoogleClient().verifyIdToken({
        idToken: token,
        audience: clientId,
      });
    } catch {
      throw new UnauthorizedException('Invalid Google credential');
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.sub?.trim()) {
      throw new UnauthorizedException('Invalid Google credential');
    }
    if (payload.email_verified !== true || !payload.email?.trim()) {
      throw new UnauthorizedException('Google account email is not verified');
    }

    const googleId = payload.sub;
    const email = payload.email.trim().toLowerCase();

    const authoritativeEmail = email.endsWith('@gmail.com') || Boolean(payload.hd?.trim());
    const linked = await this.users.findOne({ where: { googleId }, loadEagerRelations: false });
    if (!linked && !authoritativeEmail) {
      throw new UnauthorizedException('Use email and password for this email address');
    }
    let created = false;
    let user: User;
    try {
      user = await this.users.manager.transaction(async manager => {
        const users = manager.getRepository(User);
        const lock = { mode: 'pessimistic_write' } as const;
        const account = linked
          ? await users.findOne({ where: { id: linked.id }, loadEagerRelations: false, lock })
          : await users.findOne({ where: { email }, loadEagerRelations: false, lock });
        if (linked && account?.googleId !== googleId) throw new UnauthorizedException('Use your existing sign-in method');
        if (account) return this.updateGoogleAccount(manager, account, googleId, payload);

        const saved = await users.save(users.create({
          email, firstName: payload.given_name, lastName: payload.family_name, googleId, status: UserStatus.ACTIVE,
        }));
        const roles = manager.getRepository(Role);
        await roles.upsert({ code: RoleCode.CUSTOMER }, { conflictPaths: ['code'], skipUpdateIfNoValuesChanged: true });
        const role = await roles.findOneByOrFail({ code: RoleCode.CUSTOMER });
        const links = manager.getRepository(UserRole);
        await links.save(links.create({ user: saved, role }));
        created = true;
        return saved;
      });
    } catch (error) {
      if ((error as { code?: string })?.code !== '23505') throw error;
      const winner = await this.users.findOne({ where: { googleId }, loadEagerRelations: false });
      if (!winner) throw new UnauthorizedException('Use your existing sign-in method');
      user = winner;
      created = false;
    }
    const tokens = await this.sessions.create(user.id, { googleId });
    if (created) await this.sendWelcomeEmail(user);
    return { user: await this.findUserWithRoles(user.id), tokens };
  }

  private async updateGoogleAccount(manager: EntityManager, user: User, googleId: string,
    profile: { given_name?: string; family_name?: string }): Promise<User> {
    if (user.googleId && user.googleId !== googleId) throw new UnauthorizedException('Use your existing sign-in method');
    if (user.status !== UserStatus.ACTIVE) {
      // A pending password account might have been created by somebody else.
      throw new UnauthorizedException('Account is not eligible for Google sign-in');
    }
    const firstName = user.firstName || profile.given_name;
    const lastName = user.lastName || profile.family_name;
    if (user.googleId !== googleId || firstName !== user.firstName || lastName !== user.lastName) {
      user.googleId = googleId;
      user.firstName = firstName;
      user.lastName = lastName;
      await manager.getRepository(User).save(user);
    }
    return user;
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

  private async queueVerification(manager: EntityManager, user: User): Promise<boolean> {
    if (!this.authEmailOutbox?.enabled) return false;
    const appBase = frontendOrigin();
    if (!appBase) return false;
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await this.jwt.signAsync(
      { sub: user.id, email: user.email, type: 'verify', iat: issuedAt },
      { expiresIn: '24h' },
    );
    await this.authEmailOutbox.enqueue(manager, user.id,
      { kind: 'verification', email: user.email, token, frontendOrigin: appBase },
      new Date((issuedAt + 24 * 60 * 60) * 1_000));
    return true;
  }

  private async sendVerificationEmail(user: User) {
    // APP_BASE_URL may point to the API; activation links must target the frontend.
    const appBase = frontendOrigin();
    if (!appBase) return { status: 'unavailable' as const };
    try {
      const verifyToken = await this.jwt.signAsync(
        { sub: user.id, email: user.email, type: 'verify' },
        { expiresIn: '24h' },
      );
      const verifyUrl = `${appBase}/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;
      const html = buildVerifyEmailTemplate({ firstName: user.firstName, verifyUrl });
      return await this.email.sendEmail({ to: user.email, subject: 'Verify your email', html });
    } catch {
      return { status: 'failed' as const };
    }
  }

  private async sendWelcomeEmail(user: User) {
    try {
      const html = buildWelcomeEmailTemplate({ firstName: user.firstName });
      await this.email.sendEmail({ to: user.email, subject: 'Welcome to TruCycle', html });
    } catch {
      // An optional welcome notice must not turn committed registration into a failure.
    }
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
      if (this.authEmailOutbox?.enabled) {
        await this.users.manager.transaction(async manager => {
          const locked = await manager.getRepository(User).findOne({ where: { id: user.id }, loadEagerRelations: false,
            lock: { mode: 'pessimistic_write' } });
          if (locked?.status === UserStatus.PENDING && locked.email === normalizedEmail) {
            await this.queueVerification(manager, locked);
          }
        }).catch(() => this.logger.warn('Could not queue verification email'));
      } else {
        await this.sendVerificationEmail(user);
      }
    }
    // Always return success from controller to prevent user enumeration
  }

  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.users.findOne({ where: { email: normalizedEmail } });
    // Do not reveal whether the user exists; send only for eligible accounts
    if (user && user.status !== UserStatus.DELETED && user.status !== UserStatus.SUSPENDED) {
      if (this.authEmailOutbox?.enabled) {
        await this.sendResetPasswordOtpEmail(user).catch(() => this.logger.warn('Could not queue password reset email'));
      } else {
        await this.sendResetPasswordOtpEmail(user);
      }
    }
    // Controller always returns success
  }

  private getPasswordResetOtpExpiryMinutes(): number {
    const parsed = Number(process.env.PASSWORD_RESET_OTP_EXPIRES_MINUTES || '10');
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 10;
    }
    return Math.max(1, Math.min(Math.trunc(parsed), 60));
  }

  private generatePasswordResetOtp(): string {
    return String(randomInt(0, 1000000)).padStart(6, '0');
  }

  private async sendResetPasswordOtpEmail(user: User) {
    const expiresInMinutes = this.getPasswordResetOtpExpiryMinutes();
    const otp = this.generatePasswordResetOtp();
    const otpHash = await this.passwordService.hash(otp);
    const recipient = await this.users.manager.transaction(async manager => {
      const users = manager.getRepository(User);
      const locked = await users.findOne({ where: { id: user.id }, loadEagerRelations: false, lock: { mode: 'pessimistic_write' } });
      if (!locked || locked.email !== user.email || locked.status === UserStatus.DELETED || locked.status === UserStatus.SUSPENDED) return null;
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);
      await users.update(locked.id, { resetOtpHash: otpHash, resetOtpExpiresAt: expiresAt });
      if (this.authEmailOutbox?.enabled) {
        await this.authEmailOutbox.enqueue(manager, locked.id,
          { kind: 'password_reset', email: locked.email, otp, otpHash }, expiresAt);
        return null;
      }
      return { email: locked.email, firstName: locked.firstName };
    });
    if (!recipient) return;

    const html = buildPasswordResetOtpEmailTemplate({
      firstName: recipient.firstName,
      otp,
      expiresInMinutes,
      supportEmail: process.env.SUPPORT_EMAIL,
    });
    await this.email.sendEmail({ to: recipient.email, subject: 'Your password reset OTP', html });
  }

  async resetPassword(email: string, otp: string, newPassword: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedOtp = otp.trim();
    const user = await this.users.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    if (user.status === UserStatus.DELETED || user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    if (!user.resetOtpHash || !user.resetOtpExpiresAt) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    if (new Date(user.resetOtpExpiresAt).getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    const acceptedOtpHash = user.resetOtpHash;
    const otpValid = await this.passwordService.compare(normalizedOtp, acceptedOtpHash);
    if (!otpValid) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    const hash = await this.passwordService.hash(newPassword);
    await this.users.manager.transaction(async manager => {
      const users = manager.getRepository(User);
      const locked = await users.findOne({ where: { id: user.id }, loadEagerRelations: false, lock: { mode: 'pessimistic_write' } });
      if (!locked || locked.email !== normalizedEmail || locked.status === UserStatus.DELETED || locked.status === UserStatus.SUSPENDED || locked.resetOtpHash !== acceptedOtpHash ||
          !locked.resetOtpExpiresAt || new Date(locked.resetOtpExpiresAt).getTime() <= Date.now()) throw new UnauthorizedException('Invalid or expired OTP');
      locked.passwordHash = hash; locked.resetOtpHash = null; locked.resetOtpExpiresAt = null;
      await users.save(locked);
      await this.sessions.revokeAllInTransaction(manager, locked.id);
      await this.authEmailOutbox?.discard(manager, locked.id, 'password_reset');
    });

    // Optional: notify user about password change
    try {
      await this.email.sendEmail({
        to: user.email,
        subject: 'Your password has been reset',
        html: buildPasswordResetSuccessEmailTemplate({
          firstName: user.firstName,
          supportEmail: process.env.SUPPORT_EMAIL,
          loginUrl: this.passwordResetLoginUrl(),
        }),
      });
    } catch {
      // Non-fatal if email fails
    }
  }

  private passwordResetLoginUrl(): string | undefined {
    const origin = frontendOrigin();
    if (!origin) return undefined;
    const defaultUrl = `${origin}/login`;
    const override = process.env.LOGIN_URL;
    if (override) {
      try {
        const url = new URL(override, origin);
        if (url.protocol === new URL(origin).protocol && url.origin === origin && !url.username && !url.password) return url.href;
      } catch {
        // Keep the frontend login link when an override is malformed.
      }
    }
    return defaultUrl;
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
