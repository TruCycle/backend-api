import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../users/user.entity';
import { FoundItem } from './found-item.entity';

export enum FoundItemReportStatus {
  PENDING = 'pending',
  REVIEWED = 'reviewed',
  RESOLVED = 'resolved',
}

@Entity('found_item_report')
export class FoundItemReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'found_item_id', type: 'uuid' })
  foundItemId!: string;

  @ManyToOne(() => FoundItem, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'found_item_id' })
  foundItem!: FoundItem;

  @Column({ name: 'reporter_id', type: 'uuid' })
  reporterId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporter_id' })
  reporter!: User;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'text', nullable: true })
  details?: string | null;

  @Column({ type: 'enum', enum: FoundItemReportStatus, default: FoundItemReportStatus.PENDING })
  status!: FoundItemReportStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
