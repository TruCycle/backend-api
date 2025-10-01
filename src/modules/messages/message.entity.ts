import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';
import { MessageRoom } from './message-room.entity';

export enum MessageCategory {
  DIRECT = 'direct',
  GENERAL = 'general',
}

@Entity('message')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => MessageRoom, (room) => room.messages, {
    onDelete: 'CASCADE',
  })
  room!: MessageRoom;

  @ManyToOne(() => User, { nullable: true, eager: true, onDelete: 'SET NULL' })
  sender?: User | null;

  @Column({ type: 'enum', enum: MessageCategory, default: MessageCategory.DIRECT })
  category!: MessageCategory;

  @Column({ type: 'text', nullable: true })
  imageUrl?: string | null;

  @Column({ type: 'text', nullable: true })
  caption?: string | null;

  @Column({ type: 'text', nullable: true })
  text?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
