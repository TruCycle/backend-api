import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';

export enum ItemPickupOption {
  DONATE = 'donate',
  EXCHANGE = 'exchange',
  RECYCLE = 'recycle',
}

export enum ItemStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  CLAIMED = 'claimed',
  COMPLETE = 'complete',
  PENDING_DROPOFF = 'pending_dropoff',
  AWAITING_COLLECTION = 'awaiting_collection',
  REJECTED = 'rejected',
  PENDING_RECYCLE = 'pending_recycle',
  PENDING_RECYCLE_PROCESSING = 'pending_recycle_processing',
  RECYCLED = 'recycled',
}

export enum ItemCondition {
  NEW = 'new',
  LIKE_NEW = 'like_new',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
}

export interface ItemImage {
  url: string;
  altText?: string | null;
}

export enum SizeUnit {
  M = 'm',
  INCH = 'inch',
  FT = 'ft',
}

@Entity('item')
export class Item {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'donor_id' })
  donor!: User;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'enum', enum: ItemCondition })
  condition!: ItemCondition;

  @Column({ type: 'text' })
  category!: string;

  @Column({ name: 'pickup_option', type: 'enum', enum: ItemPickupOption })
  pickupOption!: ItemPickupOption;

  @Column({ type: 'enum', enum: ItemStatus })
  status!: ItemStatus;

  @Column({ name: 'dropoff_location_id', type: 'uuid', nullable: true })
  dropoffLocationId?: string | null;

  @Column({ name: 'delivery_preferences', type: 'text', nullable: true })
  deliveryPreferences?: string | null;

  @Column({ name: 'address_line', type: 'text' })
  addressLine!: string;

  @Column({ type: 'text' })
  postcode!: string;

  @Column({ type: 'jsonb', nullable: false, default: () => "'[]'::jsonb" })
  images!: ItemImage[];

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({
    name: 'location',
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  location!: any;

  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;

  @Column({ name: 'qr_code_url', type: 'text', nullable: true })
  qrCodeUrl?: string | null;

  @Column({ name: 'estimated_co2_saved_kg', type: 'double precision', nullable: true })
  estimatedCo2SavedKg?: number | null;

  @Column({ name: 'size_length', type: 'double precision', nullable: true })
  sizeLength?: number | null;

  @Column({ name: 'size_breadth', type: 'double precision', nullable: true })
  sizeBreadth?: number | null;

  @Column({ name: 'size_height', type: 'double precision', nullable: true })
  sizeHeight?: number | null;

  @Column({ name: 'size_unit', type: 'enum', enum: SizeUnit, nullable: true })
  sizeUnit?: SizeUnit | null;

  @Column({ name: 'weight_kg', type: 'double precision', nullable: true })
  weightKg?: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
