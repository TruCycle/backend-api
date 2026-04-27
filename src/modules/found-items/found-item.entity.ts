import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../users/user.entity';

export enum FoundItemStatus {
  AVAILABLE = 'available',
  CLAIMED = 'claimed',
  PICKED_UP = 'picked_up',
  EXPIRED = 'expired',
  REPORTED = 'reported',
}

export interface FoundItemImage {
  url: string;
  thumbnailUrl?: string | null;
  altText?: string | null;
}

@Entity('found_item')
export class FoundItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'poster_id', type: 'uuid' })
  posterId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'poster_id' })
  poster!: User;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ type: 'text' })
  category!: string;

  @Column({ type: 'text', nullable: true })
  condition?: string | null;

  @Column({ type: 'enum', enum: FoundItemStatus, default: FoundItemStatus.AVAILABLE })
  status!: FoundItemStatus;

  @Column({ type: 'text', nullable: true })
  address?: string | null;

  @Column({ type: 'text', nullable: true })
  neighborhood?: string | null;

  @Column({ type: 'text' })
  postcode!: string;

  @Column({ type: 'double precision', nullable: true })
  latitude?: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude?: number | null;

  @Column({ type: 'jsonb', nullable: false, default: () => "'[]'::jsonb" })
  images!: FoundItemImage[];

  @Column({ name: 'view_count', type: 'integer', default: 0 })
  viewCount!: number;

  @CreateDateColumn({ name: 'posted_at', type: 'timestamptz' })
  postedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
