import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';

import { User } from '../users/user.entity';

@Entity('user_review')
@Unique('uq_reviewer_target', ['reviewerUser', 'targetUser'])
export class UserReview {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'target_user_id' })
  targetUser!: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reviewer_user_id' })
  reviewerUser!: User;

  @Column({ type: 'numeric', precision: 2, scale: 1 })
  rating!: string; // store as string due to numeric type; parseFloat when using

  @Column({ type: 'text', nullable: true })
  comment?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

