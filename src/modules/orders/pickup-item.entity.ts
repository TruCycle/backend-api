import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { PickupOrder } from './pickup-order.entity';

@Entity('pickup_item')
export class PickupItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => PickupOrder, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: PickupOrder;

  @Column({ name: 'material_code', type: 'text', nullable: true })
  materialCode?: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 3, nullable: true })
  quantity?: string | null; // store as string per TypeORM numeric

  @Column({ type: 'text', nullable: true })
  unit?: string | null; // e.g., 'kg' | 'pcs'

  // WEEE-specific flexible data
  @Column({ type: 'jsonb', nullable: true })
  weee?: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

