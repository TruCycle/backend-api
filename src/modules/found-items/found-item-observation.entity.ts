import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';

import { User } from '../users/user.entity';

import { FoundItem } from './found-item.entity';

@Entity('found_item_observation')
@Unique('uq_found_item_observation_item_observer', ['foundItemId', 'observerId'])
export class FoundItemObservation {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'found_item_id', type: 'uuid' }) foundItemId!: string;
  @ManyToOne(() => FoundItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'found_item_id' }) foundItem!: FoundItem;
  @Column({ name: 'observer_id', type: 'uuid' }) observerId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'observer_id' }) observer!: User;
  @Column({ type: 'text' }) kind!: 'still_there' | 'gone';
  @Column({ name: 'observed_at', type: 'timestamptz' }) observedAt!: Date;
}
