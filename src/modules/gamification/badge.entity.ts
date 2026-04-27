import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum GamificationBadgeCategory {
  MILESTONE = 'milestone',
  STREAK = 'streak',
  IMPACT = 'impact',
  COMMUNITY = 'community',
  SPECIAL = 'special',
}

export enum GamificationBadgeRarity {
  COMMON = 'common',
  RARE = 'rare',
  EPIC = 'epic',
  LEGENDARY = 'legendary',
}

@Entity('gamification_badge')
export class GamificationBadge {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'enum', enum: GamificationBadgeCategory })
  category!: GamificationBadgeCategory;

  @Column({ type: 'enum', enum: GamificationBadgeRarity })
  rarity!: GamificationBadgeRarity;

  @Column({ name: 'icon_url', type: 'text', nullable: true })
  iconUrl?: string | null;

  @Column({ type: 'text' })
  requirement!: string;

  @Column({ name: 'points_awarded', type: 'integer', default: 0 })
  pointsAwarded!: number;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
