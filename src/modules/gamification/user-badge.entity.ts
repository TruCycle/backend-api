import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../users/user.entity';
import { GamificationBadge } from './badge.entity';

@Entity('user_badge')
export class UserBadge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'badge_id', type: 'text' })
  badgeId!: string;

  @ManyToOne(() => GamificationBadge, { nullable: false, onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'badge_id' })
  badge!: GamificationBadge;

  @CreateDateColumn({ name: 'earned_at', type: 'timestamptz' })
  earnedAt!: Date;

  @Column({ name: 'is_notified', type: 'boolean', default: false })
  isNotified!: boolean;
}
