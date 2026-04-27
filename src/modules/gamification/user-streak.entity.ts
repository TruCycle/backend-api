import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../users/user.entity';

export enum GamificationStreakType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

@Entity('user_streak')
export class UserStreak {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'streak_type', type: 'enum', enum: GamificationStreakType })
  streakType!: GamificationStreakType;

  @Column({ name: 'current_streak', type: 'integer', default: 0 })
  currentStreak!: number;

  @Column({ name: 'longest_streak', type: 'integer', default: 0 })
  longestStreak!: number;

  @Column({ name: 'last_activity_date', type: 'date', nullable: true })
  lastActivityDate?: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
