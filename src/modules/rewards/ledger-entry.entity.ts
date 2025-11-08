import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Wallet } from './wallet.entity';

export enum LedgerEntryType {
  DEBIT = 'debit',
  CREDIT = 'credit',
}

export enum LedgerPurpose {
  CLAIM_COMPLETE_COLLECTOR = 'claim_complete_collector',
  CLAIM_COMPLETE_DONOR = 'claim_complete_donor',
}

@Entity('ledger_entry')
@Index(['wallet', 'purpose', 'ref'], { unique: true })
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Wallet, (w) => w.entries, { nullable: false, onDelete: 'CASCADE' })
  wallet!: Wallet;

  @Column({ type: 'enum', enum: LedgerEntryType })
  type!: LedgerEntryType;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ name: 'balance_after', type: 'numeric', precision: 14, scale: 2 })
  balanceAfter!: string;

  @Column({ type: 'enum', enum: LedgerPurpose })
  purpose!: LedgerPurpose;

  @Column({ type: 'text' })
  ref!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

