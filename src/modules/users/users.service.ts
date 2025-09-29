import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateUserDto } from './dto/create-user.dto';
import { KycProfile, KycStatus } from './kyc-profile.entity';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    @InjectRepository(KycProfile)
    private readonly kycs: Repository<KycProfile>,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const user = this.repo.create({ email: dto.email });
    return this.repo.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async getVerification(userId: string) {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const kyc = await this.kycs.findOne({ where: { user: { id: userId } }, relations: { user: true } });
    let addressVerified = false;
    try {
      const rows: any[] = await this.repo.query('SELECT COUNT(1) AS cnt FROM address WHERE user_id = $1', [userId]);
      addressVerified = Number(rows?.[0]?.cnt || 0) > 0;
    } catch {
      addressVerified = false;
    }
    return {
      email_verified: user.status === 'active',
      identity_verified: kyc?.status === KycStatus.APPROVED,
      address_verified: addressVerified,
    };
  }

  async updateProfileImage(userId: string, url: string) {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (typeof url !== 'string' || !url.trim()) {
      throw new BadRequestException('profile_image_url is required');
    }
    user.profileImageUrl = url.trim();
    const saved = await this.repo.save(user);
    return { id: saved.id, profile_image_url: saved.profileImageUrl };
  }
}

