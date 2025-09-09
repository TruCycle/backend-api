import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  OneToMany,
} from 'typeorm';
import { UserRole } from './user-role.entity';

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

@Entity('user')
@Unique(['email'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text', nullable: true })
  phone?: string | null;

  @Column({ type: 'text', nullable: true })
  passwordHash?: string | null;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  // Sprint-specific: referral linkage
  @Column({ type: 'uuid', nullable: true })
  referredBy?: string | null;

  // Explicit join entity for roles
  // Eager-load role objects via UserRole -> Role
  @OneToMany(() => UserRole, (ur) => ur.user, {
    cascade: ['insert'],
    eager: true,
  })
  userRoles!: UserRole[];
}
