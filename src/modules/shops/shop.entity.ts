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

@Entity('shop')
export class Shop {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id' })
  owner!: User;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'phone_number', type: 'text', nullable: true })
  phoneNumber?: string | null;

  @Column({ name: 'address_line', type: 'text' })
  addressLine!: string;

  @Column({ type: 'text' })
  postcode!: string;

  @Column({ name: 'opening_hours', type: 'jsonb', nullable: true })
  openingHours?: {
    days?: string[];
    open_time?: string;
    close_time?: string;
  } | null;

  @Column({ name: 'acceptable_categories', type: 'jsonb', nullable: true })
  acceptableCategories?: string[] | null;

  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;

  @Column({
    name: 'geom',
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  geom!: any;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
