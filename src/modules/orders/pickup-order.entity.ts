import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  VersionColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Address } from '../addresses/address.entity';
import { ServiceZone } from '../addresses/service-zone.entity';
import { PickupItem } from './pickup-item.entity';

export enum PickupOrderStatus {
  DRAFT = 'draft',
  PLACED = 'placed',
  SCHEDULED = 'scheduled',
  ASSIGNED = 'assigned',
  PICKED_UP = 'picked_up',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

@Entity('pickup_order')
export class PickupOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer!: User;

  @ManyToOne(() => Address, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'origin_address_id' })
  originAddress?: Address | null;

  @ManyToOne(() => ServiceZone, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zone_id' })
  zone?: ServiceZone | null;

  @Column({ type: 'enum', enum: PickupOrderStatus, default: PickupOrderStatus.DRAFT })
  status!: PickupOrderStatus;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt?: Date | null;

  @Column({ name: 'placed_at', type: 'timestamptz', nullable: true })
  placedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  channel?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  geom!: any; // WGS84 point

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason?: string | null;

  @VersionColumn()
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => PickupItem, (item) => item.order, { cascade: ['insert'] })
  items!: PickupItem[];
}

