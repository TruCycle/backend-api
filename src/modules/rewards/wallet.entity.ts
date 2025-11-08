import { Column, CreateDateColumn, Entity, Index, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { LedgerEntry } from './ledger-entry.entity';

export enum WalletStatus {
  ACTIVE = 'active',
  FROZEN = 'frozen',
}

@Entity('wallet')
@Index(['owner', 'currency'], { unique: true })
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  owner!: User;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ name: 'available_amount', type: 'numeric', precision: 14, scale: 2, default: 0 })
  availableAmount!: string;

  @Column({ name: 'pending_amount', type: 'numeric', precision: 14, scale: 2, default: 0 })
  pendingAmount!: string;

  @Column({ type: 'enum', enum: WalletStatus, default: WalletStatus.ACTIVE })
  status!: WalletStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => LedgerEntry, (le) => le.wallet)
  entries!: LedgerEntry[];
}

