import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../users/user.entity';
import { FoundItem } from './found-item.entity';

export enum FoundItemClaimStatus {
  PENDING = 'pending',
  ACKNOWLEDGED = 'acknowledged',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Entity('found_item_claim')
export class FoundItemClaim {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'found_item_id', type: 'uuid' })
  foundItemId!: string;

  @ManyToOne(() => FoundItem, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'found_item_id' })
  foundItem!: FoundItem;

  @Column({ name: 'claimer_id', type: 'uuid' })
  claimerId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'claimer_id' })
  claimer!: User;

  @Column({ type: 'text', nullable: true })
  message?: string | null;

  @Column({ type: 'enum', enum: FoundItemClaimStatus, default: FoundItemClaimStatus.PENDING })
  status!: FoundItemClaimStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
