import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';
import { Message } from './message.entity';

function buildPairKey(userA: string, userB: string): string {
  return [userA, userB].sort().join(':');
}

@Entity('message_room')
@Unique(['pairKey'])
export class MessageRoom {
  static buildPairKey(userA: string, userB: string): string {
    return buildPairKey(userA, userB);
  }

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  userOne!: User;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  userTwo!: User;

  @Column({ type: 'text' })
  pairKey!: string;

  @Column({ type: 'boolean', default: false })
  deleted!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Message, (message) => message.room)
  messages!: Message[];
}
