import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { Item } from '../items/item.entity';
import { User } from '../users/user.entity';

export enum ClaimStatus {
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

@Entity('claim')
@Unique(['item'])
export class Claim {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Item, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'item_id' })
  item!: Item;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'collector_id' })
  collector!: User;

  @Column({ type: 'enum', enum: ClaimStatus, default: ClaimStatus.PENDING_APPROVAL })
  status!: ClaimStatus;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
