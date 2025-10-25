import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';

@Entity('notification')
@Index(['user', 'read', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // String code for routing on client (e.g. 'item.claim.request')
  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  body?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data?: Record<string, any> | null;

  @Column({ name: 'read', type: 'boolean', default: false })
  read!: boolean;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export interface NotificationViewModel {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, any> | null;
  read: boolean;
  createdAt: Date;
  readAt: Date | null;
}

