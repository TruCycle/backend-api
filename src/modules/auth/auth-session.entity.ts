import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { User } from '../users/user.entity';

@Entity('auth_session')
@Index('auth_session_user_active_idx', ['userId'], { where: 'revoked_at IS NULL' })
@Index('auth_session_expiry_idx', ['expiresAt'])
export class AuthSession {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' }) user!: User;
  @Column({ name: 'refresh_hash', type: 'char', length: 64, select: false }) refreshHash!: string;
  @Column({ name: 'previous_refresh_hash', type: 'char', length: 64, nullable: true, select: false }) previousRefreshHash!: string | null;
  @Column({ type: 'integer', default: 0 }) generation!: number;
  @Column({ name: 'refresh_issued_at', type: 'timestamptz' }) refreshIssuedAt!: Date;
  @Column({ name: 'previous_valid_until', type: 'timestamptz', nullable: true }) previousValidUntil!: Date | null;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'last_used_at', type: 'timestamptz' }) lastUsedAt!: Date;
}
